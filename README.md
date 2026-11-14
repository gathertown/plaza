# @gathertown/plaza

Presenters, MobX helpers and async state for React apps. Gather builds its web and mobile apps on these, and this package is the copy Gather runs.

- `@gathertown/plaza/presenter`: `BasePresenter`, `usePresenter` and `AsyncState`.
- `@gathertown/plaza/mobx`: `Destructible`, the `@ga` decorators and wrappers around MobX's `reaction` and `autorun`.
- `@gathertown/plaza`: hooks for reporting errors thrown inside reactions.
- `@gathertown/plaza/testing`: Jest helpers.
- `@gathertown/plaza/helpers`: other general helpers.

## Install

```sh
npm install @gathertown/plaza
```

Plaza needs `mobx` ~7.0.6 as a peer. `react` ^19 is an optional peer, needed only for `/presenter`. The examples below use `observer` from `mobx-react-lite`, and a React app needs a renderer like `react-dom`. Install whichever of these you don't have yet.

## Decorators

Plaza's `@ga` decorators are standard decorators, so they need a compiler that emits them. Legacy decorators don't work.

- TypeScript 5 or later, with `experimentalDecorators` off.
- swc: `jsc.transform.decoratorVersion: "2022-03"`.
- Babel: `@babel/plugin-proposal-decorators` with `{ version: "2023-11" }`.

## Observable classes

`@ga.observableClass` makes a class observable once its constructor finishes. Every data field becomes a MobX observable, and the other `@ga` annotations on the class take effect. The class extends `Destructible`, because its computeds are torn down when `destroy()` runs.

```ts
import { Destructible, ga } from "@gathertown/plaza/mobx"

@ga.observableClass
class Cart extends Destructible {
  items: Item[] = []

  @ga.computed
  get total(): number {
    return this.items.reduce((sum, item) => sum + item.price, 0)
  }

  @ga.action
  add(item: Item) {
    this.items.push(item)
  }
}
```

- `@ga.observableClass.exclude(["field"])` leaves the named fields plain.
- `@ga.action` runs a method as a MobX action. `@ga.action.bound` also binds it, for methods passed as callbacks. `@ga.action.allowPromiseReturn` lets a sync method return a promise.
- `@ga.computed` caches a getter until something it reads changes. It stays cached while nothing observes it, until `destroy()` runs. `@ga.computed.equals(comparer)` takes a custom equality check.
- `@ga.flow` and `@ga.flow.bound` run generator methods as MobX flows.
- `@ga.presenter.computed_DO_NOT_USE_PROPS` is `@ga.computed` for presenters. It can't read `this.props`, because props aren't observable.
- A subclass of an observable class needs the decorator too, and plaza throws outside production builds when it's missing. `@ga.observableClass({ enforceSubclasses: false })` turns that off.
- An optional `afterObservable()` method runs once, right after the class becomes observable.

## How Gather structures a frontend

Business logic lives in three kinds of classes. Models hold state and the rules for changing it. Repos load and store collections of models. Services coordinate several repos and have no state of their own. This structure borrows from Domain Driven Design (DDD) principles.

A presenter connects one React component to that logic. Presenters allow you to create view-specific business logic that isn't tied to React and therefore much easier to test and share around the codebase. It's a class with one instance per mounted component. Observable fields replace `useState`, getters replace `useMemo`, and reactions replace `useEffect`. Components only lay out and style what the presenter exposes, so most UI behavior can be tested without rendering.

A presenter has three lifecycle hooks. Keep the constructor empty, because fields aren't observable yet when it runs.

- `afterObservable()` runs once before the first render. Set local state here, and seed it from observables with `this.reaction(..., { fireImmediately: true })` or `this.autorun()`. Don't change global state.
- `afterMount()` runs once after the component mounts. Load data, add listeners and change global state here. Destructors added with `this.addDestructor()` run on unmount.
- `afterMountOrPropChange()` runs after mount and again whenever props change. Props aren't observable, so anything that depends on them goes here. Its destructors run before the next prop change.

`this.reaction()` and `this.autorun()` register only once the presenter mounts, so a render React throws away leaves no subscription behind. Pass `{ withProps: true }` to re-register on every prop change. For async work in a hook, start it without returning the promise, because only the synchronous part runs inside the hook's scope.

## A presenter

```tsx
import { ga } from "@gathertown/plaza/mobx"
import { BasePresenter, usePresenter } from "@gathertown/plaza/presenter"
import { observer } from "mobx-react-lite"

@ga.observableClass
class CounterPresenter extends BasePresenter<Record<string, never>>()() {
  count = 0

  @ga.computed
  get label(): string {
    return `Clicked ${this.count} times`
  }

  @ga.action
  increment() {
    this.count += 1
  }
}

export const Counter = observer(() => {
  const { presenter } = usePresenter(CounterPresenter)
  return <button onClick={() => presenter.increment()}>{presenter.label}</button>
})
```

`BasePresenter<Props>()` takes the props type. Its second call takes an optional function that returns the presenter's async dependencies, which this presenter doesn't have. `usePresenter` creates one instance per mounted component and destroys it on unmount.

The test needs no React:

```ts
it("increments", () => {
  const presenter = new CounterPresenter({})

  presenter.increment()

  expect(presenter.label).toEqual("Clicked 1 times")
})
```

### Async state

`AsyncState` wraps a load, and a presenter can take it as a dependency. The dependencies function runs on every render, so create the `AsyncState` outside the presenter.

Every `AsyncState` takes the object it belongs to, usually `this` inside a `Destructible` class. Once that object is destroyed, the state starts no load and drops answers that arrive late. A state that lasts as long as the page takes `AsyncState.neverDestroyed` instead.

```tsx
import { ga } from "@gathertown/plaza/mobx"
import { AsyncState, BasePresenter, usePresenter } from "@gathertown/plaza/presenter"
import { observer } from "mobx-react-lite"

const fetchProfile = async (): Promise<{ name: string; role: string }> => {
  const response = await fetch("/api/profile")
  return response.json()
}

const profileState = new AsyncState(AsyncState.neverDestroyed, () => fetchProfile())

@ga.observableClass
class ProfilePresenter extends BasePresenter<Record<string, never>>()(() => ({
  profile: profileState,
})) {
  get title(): string {
    return `${this.asyncDeps.profile.name} (${this.asyncDeps.profile.role})`
  }
}

export const Profile = observer(() => {
  const { presenter } = usePresenter(ProfilePresenter)
  return <h1>{presenter.title}</h1>
})
```

`usePresenter` suspends until every `AsyncState` in the dependencies has loaded, so render it as `<Suspense fallback={null}><Profile /></Suspense>`. Inside the presenter, `asyncDeps` is the loaded data. A test that reads `asyncDeps` awaits `profileState.ensureLoaded()` first.

## Logging and cancellation

Plaza logs to `console.error` and `console.warn`. `AsyncState` treats a load as canceled when it rejects with an error named `CanceledError`, which axios throws for a canceled request. Any other rejection, including a fetch `AbortError`, counts as a failure. Destroying an `AsyncState` itself cancels its load, and a destroyed one never calls its load function again.

## MobX builds

Plaza ships CommonJS and ESM builds with the same `exports` conditions as MobX, so a bundler hands plaza the same MobX copy as your app.

Shipping both builds has a cost that Node calls the dual package hazard. If one dependency `require`s plaza and your app `import`s it, a bundler can load both builds. The two copies don't share classes or decorator metadata, so `instanceof Destructible` fails across them. Resolve every import of plaza the same way, for example with a bundler alias to one entry. Any library that ships both formats carries the same risk.

Plaza reads a few MobX internals, because MobX has no public way to tear down a keep-alive computed. MobX's minified CommonJS production build renames them. Bundlers pick MobX's unminified ESM build, so bundled apps need nothing. A Node server that sets `NODE_ENV=production` loads the minified build, which a preload can redirect on Node 22.15 or later:

```js
// node --require ./unminifiedMobx.cjs app.js
require("node:module").registerHooks({
  resolve: (specifier, context, nextResolve) =>
    nextResolve(specifier === "mobx" ? "mobx/dist/mobx.mjs" : specifier, context),
})
```

## Lint rules

Gather checks four rules that plaza's patterns depend on. They sit in Gather's private ESLint plugin and don't ship with plaza, so nothing warns you when you break them. Follow them by hand:

- Register `this.reaction` and event listeners in `afterMount` or `afterMountOrPropChange`. A reaction with `fireImmediately: true` goes in `afterObservable` instead. React's concurrent renderer builds presenters it later throws away, and a subscription made anywhere else leaks with them.
- Call `addDestructor` before the first `await` in `afterMount` and `afterMountOrPropChange`, and don't chain `.then()`. React needs the cleanup function back synchronously, so a destructor added after an `await` is never registered.
- Inside a class decorated with `@ga.observableClass`, don't refer to the class by name in its methods. The reference goes stale, so use `getFixedClassRef(this, Class)`.
- Give every `just()` call a static message that says what you expected. Keep emails, tokens and IDs out of it, because the message can reach your logs.

## About

Plaza is shared with <3 from Gather. It's a collection of internal tools, patterns, and architecture that we've developed over the years. We hope it inspires and supports you in building great things!

We recognize this repo isn't optimized for general consumption. We're not too worried about that right now. Issues and PRs may or may not be noticed.

## License

MIT
