import { expectTypeOf } from "expect-type"
import { computed, configure, getDependencyTree, makeAutoObservable, runInAction } from "mobx"
import { pluck } from "ramda"

import { deferredPromise } from "../../helpers"
import {
  registerMobxReactionErrorSink,
  resetMobxReactionErrorReportingForTesting,
} from "../../index"
import {
  flushPromises,
  setUpErrorSilencing,
  silenceErrors,
  silenceLoggerErrors,
} from "../../testing"
import { ga } from "../decorators"
import { Destructible } from "../Destructible"
import {
  autorun,
  autorunAsync,
  autorunWithCleanup,
  createSetterFor,
  extendObservable,
  FieldAccessorReplacedError,
  isComputedProp,
  isObservableProp,
  makeObservable,
  markDeps,
  ObjectLevelModelObserveError,
  observable,
  observe,
  observeFieldSymbol,
  reaction,
  reactionWithCleanup,
  waitForExistence,
  waitUntil,
  yieldPromise,
} from "../mobx-utils"
import { registerMobxReactionErrorReporting } from "../mobxReactionErrors"

setUpErrorSilencing()

let consoleWarn: jest.SpyInstance

beforeEach(() => {
  configure({ enforceActions: "always" }) // enforce 'runInAction'
  // if trying to change state outside of 'runInAction' will log warnings
  // [MobX] Since strict-mode is enabled, changing (observed) observable values without using an action is not allowed
  consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {})
})

describe("#autorunAsync", () => {
  let state: { foo: number; bar: number; baz: string }

  beforeEach(() => {
    state = { foo: 1, bar: 2, baz: "initial value" }
    makeAutoObservable(state)
  })

  it("runs the view function when called", async () => {
    const view = jest.fn(function* () {
      const value1 = yield* yieldPromise(Promise.resolve(state.foo + 3))
      runInAction(() => (state.bar = value1))

      const value2 = yield* yieldPromise(Promise.resolve(`${state.foo + 4}`))
      runInAction(() => (state.baz = value2))
    })

    autorunAsync(view)
    await flushPromises()

    expect(view).toHaveBeenCalledTimes(1)
    expect(state.foo).toEqual(1)
    expect(state.bar).toEqual(4)
    expect(state.baz).toEqual("5")
    expect(consoleWarn).not.toHaveBeenCalled()
  })

  it("runs the view function when state changes", async () => {
    const view = jest.fn(function* () {
      const value1 = yield* yieldPromise(Promise.resolve(state.foo + 3))
      runInAction(() => (state.bar = value1))

      const value2 = yield* yieldPromise(Promise.resolve(`${state.foo + 4}`))
      runInAction(() => (state.baz = value2))
    })

    autorunAsync(view)
    await flushPromises()
    runInAction(() => (state.foo = 2))
    await flushPromises()

    expect(view).toHaveBeenCalledTimes(2)
    expect(state.foo).toEqual(2)
    expect(state.bar).toEqual(5)
    expect(state.baz).toEqual("6")
    expect(consoleWarn).not.toHaveBeenCalled()
  })

  it("does not run the view function after dispose fn is called", async () => {
    const view = jest.fn(function* () {
      const value1 = yield* yieldPromise(Promise.resolve(state.foo + 3))
      runInAction(() => (state.bar = value1))
      const value2 = yield* yieldPromise(Promise.resolve(`${state.foo + 4}`))
      runInAction(() => (state.baz = value2))
    })

    const disposer = autorunAsync(view)
    await flushPromises()
    disposer()
    runInAction(() => (state.foo = 2))
    await flushPromises()

    expect(view).toHaveBeenCalledTimes(1)
    expect(consoleWarn).not.toHaveBeenCalled()
  })

  it("aborts previous runs when state changes when previous runs are still pending", async () => {
    const { promise, resolve } = deferredPromise()

    let ranToCompletionCount = 0

    const view = jest.fn(function* () {
      const value1 = yield* yieldPromise(Promise.resolve(state.foo + 1))
      runInAction(() => (state.bar = value1))

      yield* yieldPromise(promise)

      const value2 = yield* yieldPromise(Promise.resolve(`${state.foo + 2}`))
      runInAction(() => (state.baz = value2))
      ranToCompletionCount++
    })

    autorunAsync(view)
    await flushPromises()
    runInAction(() => (state.foo = 2)) // should call 'view' fn again
    await flushPromises()
    runInAction(() => (state.foo = 3)) // should call 'view' fn again
    await flushPromises()
    resolve()
    await flushPromises()

    expect(view).toHaveBeenCalledTimes(3)
    expect(state.foo).toEqual(3)
    expect(state.bar).toEqual(4)
    expect(state.baz).toEqual("5")
    expect(ranToCompletionCount).toEqual(1) // should only have ran to completion once
    expect(consoleWarn).not.toHaveBeenCalled()
  })

  it("calls the onError handler if specified", async () => {
    silenceLoggerErrors("[MobxReactionError] autorunAsync")
    const view = jest.fn(function* () {
      yield* yieldPromise(Promise.resolve())
      throw new Error("test")
    })
    const onError = jest.fn()

    autorunAsync(view, { onError })
    await flushPromises()

    expect(view).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(consoleWarn).not.toHaveBeenCalled()
  })
})

describe("#autorunWithCleanup", () => {
  it("calls cleanup on dispose", () => {
    const cleanup = jest.fn()
    const view = jest.fn(() => cleanup)
    const dispose = autorunWithCleanup(view)
    expect(view).toHaveBeenCalledTimes(1)

    dispose()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it("calls cleanup when rerunning autorun", () => {
    const state = observable({ foo: 1 })
    const cleanup = jest.fn()
    const view = jest.fn(() => {
      markDeps(state.foo)
      return cleanup
    })

    autorunWithCleanup(view)
    expect(view).toHaveBeenCalledTimes(1)
    expect(cleanup).toHaveBeenCalledTimes(0)

    state.foo = 2
    expect(view).toHaveBeenCalledTimes(2)
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it("calls the correct cleanup function", () => {
    const state = observable({ foo: 1 })
    const cleanup = jest.fn((foo) => foo)
    const view = jest.fn(() => {
      const currentFoo = state.foo
      return () => cleanup(currentFoo)
    })

    const disposer = autorunWithCleanup(view)
    expect(view).toHaveBeenCalledTimes(1)

    state.foo = 2
    expect(view).toHaveBeenCalledTimes(2)
    expect(cleanup).toHaveBeenCalledWith(1)

    state.foo = 3
    expect(view).toHaveBeenCalledTimes(3)
    expect(cleanup).toHaveBeenCalledWith(2)

    disposer()
    expect(cleanup).toHaveBeenCalledWith(3)
    expect(cleanup).toHaveBeenCalledTimes(3)
  })
})

describe("#reactionWithCleanup", () => {
  it("calls cleanup on dispose", () => {
    const state = observable({ foo: 1 })

    const cleanup = jest.fn()
    const view = jest.fn(() => cleanup)
    const disposer = reactionWithCleanup(() => state.foo, view, { fireImmediately: true })
    expect(view).toHaveBeenCalledTimes(1)

    disposer()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it("calls cleanup when rerunning reaction", () => {
    const state = observable({ foo: 1 })
    const cleanup = jest.fn()
    const view = jest.fn(() => {
      markDeps(state.foo)
      return cleanup
    })

    reactionWithCleanup(() => state.foo, view, { fireImmediately: true })
    expect(view).toHaveBeenCalledTimes(1)
    expect(cleanup).toHaveBeenCalledTimes(0)

    state.foo = 2
    expect(view).toHaveBeenCalledTimes(2)
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it("calls the correct cleanup function", () => {
    const state = observable({ foo: 1 })
    const cleanup = jest.fn((foo) => foo)
    const view = jest.fn(() => {
      const currentFoo = state.foo
      return () => cleanup(currentFoo)
    })

    const disposer = reactionWithCleanup(() => state.foo, view, { fireImmediately: true })
    expect(view).toHaveBeenCalledTimes(1)

    state.foo = 2
    expect(view).toHaveBeenCalledTimes(2)
    expect(cleanup).toHaveBeenCalledWith(1)

    state.foo = 3
    expect(view).toHaveBeenCalledTimes(3)
    expect(cleanup).toHaveBeenCalledWith(2)

    disposer()
    expect(cleanup).toHaveBeenCalledWith(3)
    expect(cleanup).toHaveBeenCalledTimes(3)
  })
})

describe("#waitForExistence", () => {
  it("waits for the condition to return a defined value and returns the value", async () => {
    const state: { foo: string | undefined } = observable({ foo: undefined })
    let isPromiseCompleted = false
    const promise = waitForExistence(() => state.foo)
    promise.then(() => (isPromiseCompleted = true))

    await flushPromises()
    expect(isPromiseCompleted).toEqual(false)

    state.foo = "value"

    const returnValue = await promise

    expect(isPromiseCompleted).toEqual(true)
    expect(returnValue).toEqual("value")
  })

  it("doesn't complete the condition on undefined value", async () => {
    const state = observable({ foo: undefined })

    let isPromiseCompleted = false
    waitForExistence(() => state.foo).then(() => (isPromiseCompleted = true))

    await flushPromises()
    expect(isPromiseCompleted).toEqual(false)
  })

  it("doesn't complete the condition on null value", async () => {
    const state = observable({ foo: null })

    let isPromiseCompleted = false
    waitForExistence(() => state.foo).then(() => (isPromiseCompleted = true))

    await flushPromises()
    expect(isPromiseCompleted).toEqual(false)
  })

  it("cancels", async () => {
    const state: { foo: string | undefined } = observable({ foo: undefined })

    let promiseState = "pending"
    const promise = waitForExistence(() => state.foo)
    promise.then(() => (promiseState = "resolved")).catch(() => (promiseState = "rejected"))

    promise.cancel()

    state.foo = "value"
    await flushPromises()
    expect(promiseState).toEqual("rejected")
  })
})

describe("#waitUntil", () => {
  it("resolves true once the predicate turns true", async () => {
    const state = observable({ ready: false })
    const waited = waitUntil(() => state.ready, { signal: new AbortController().signal })

    state.ready = true

    expect(await waited).toEqual(true)
  })

  it("resolves false when the signal aborts first", async () => {
    const state = observable({ ready: false })
    const aborter = new AbortController()
    const waited = waitUntil(() => state.ready, { signal: aborter.signal })

    aborter.abort()

    expect(await waited).toEqual(false)
  })
})

describe("#markDeps", () => {
  class Test {
    foo = 0
    act() {}
  }

  describe("throws for function dep", () => {
    it.each([() => {}, async () => {}, function* () {}, new Function(), new Test().act])(
      "%s",
      (f) => {
        expect(() => markDeps(f)).toThrow()
      },
    )
  })

  it("does not throw for valid observable object deps", () => {
    markDeps(
      observable({}),
      observable.map({}),
      observable.set([]),
      observable.box(0),
      makeAutoObservable(new Test()),
    )
  })

  it("does not throw for non-object, non-function deps", () => {
    markDeps(0, -1, 0.1, "a", "", NaN, undefined, null, Infinity, true, false, Symbol("hi"))
  })
})

describe("#createSetterFor", () => {
  @ga.observableClass
  class Test extends Destructible {
    foo = ""
    setFoo = createSetterFor(this, "foo")

    // it does not work for `private` fields unfortunately, that is a current limitation
    private bar = ""
    // @ts-expect-error
    setBar = createSetterFor(this, "bar")
  }

  let test: Test
  beforeEach(() => {
    test = new Test()
  })

  it("allows setting a value", () => {
    test.setFoo("foo")

    expect(test.foo).toEqual("foo")
  })

  it("provides type safety", () => {
    // @ts-expect-error
    test.setFoo(1)

    const ret = test.setFoo("foo")
    expectTypeOf(ret).toMatchTypeOf<void>()
  })

  it("binds the method", () => {
    const setter = test.setFoo
    setter("foo")
    expect(test.foo).toEqual("foo")
  })

  it("only allows setting for properties of the class", async () => {
    const obj = { foo: "" }
    createSetterFor(obj, "foo")
    // @ts-expect-error
    createSetterFor(obj, "bar")
  })
})

describe("reaction error reporting", () => {
  beforeEach(() => {
    resetMobxReactionErrorReportingForTesting()
  })

  it("reports a thrown reaction effect error once with name and kind", () => {
    const sink = jest.fn()
    registerMobxReactionErrorSink(sink)
    const box = observable.box(0)
    const dispose = reaction(
      () => box.get(),
      (value) => {
        if (value > 0) throw new Error("effect boom")
      },
      { name: "myReaction" },
    )

    runInAction(() => box.set(1))

    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink.mock.calls[0][1]).toEqual({
      reactionName: "myReaction",
      kind: "Reaction",
      suppressedCount: 0,
    })
    dispose()
  })

  it("reports a thrown reaction expression error", () => {
    const sink = jest.fn()
    registerMobxReactionErrorSink(sink)
    const box = observable.box(0)
    const dispose = reaction(
      () => {
        if (box.get() > 0) throw new Error("expression boom")
        return box.get()
      },
      () => {},
      { name: "expressionReaction" },
    )

    runInAction(() => box.set(1))

    expect(sink).toHaveBeenCalledTimes(1)
    dispose()
  })

  it("keeps the reaction alive after an error", () => {
    registerMobxReactionErrorSink(jest.fn())
    const box = observable.box(0)
    const seen: number[] = []
    const dispose = reaction(
      () => box.get(),
      (value) => {
        seen.push(value)
        if (value === 1) throw new Error("boom once")
      },
      { name: "survivor" },
    )

    runInAction(() => box.set(1)) // throws
    runInAction(() => box.set(2)) // must still fire

    expect(seen).toEqual([1, 2])
    dispose()
  })

  it("still calls a caller-supplied onError after reporting", () => {
    const sink = jest.fn()
    registerMobxReactionErrorSink(sink)
    const callerOnError = jest.fn()
    const box = observable.box(0)
    const dispose = autorun(
      () => {
        if (box.get() > 0) throw new Error("autorun boom")
      },
      { name: "withCallerHandler", onError: callerOnError },
    )

    runInAction(() => box.set(1))

    expect(sink).toHaveBeenCalledTimes(1)
    expect(callerOnError).toHaveBeenCalledTimes(1)
    dispose()
  })

  it("does not propagate a throwing caller onError (reactivity survives)", () => {
    registerMobxReactionErrorSink(jest.fn())
    const box = observable.box(0)
    const runs: number[] = []
    const dispose = autorun(
      () => {
        runs.push(box.get())
        if (box.get() === 1) throw new Error("boom")
      },
      {
        name: "throwingCallerHandler",
        onError: () => {
          throw new Error("handler boom")
        },
      },
    )

    expect(() => runInAction(() => box.set(1))).not.toThrow()
    runInAction(() => box.set(2))
    expect(runs).toEqual([0, 1, 2])
    dispose()
  })

  it("does not double-report wrapped reactions through the global backstop", () => {
    const sink = jest.fn()
    const disposeGlobal = registerMobxReactionErrorReporting(sink)
    const box = observable.box(0)
    const dispose = reaction(
      () => box.get(),
      (value) => {
        if (value > 0) throw new Error("boom")
      },
      { name: "wrapped" },
    )

    runInAction(() => box.set(1))

    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink.mock.calls[0][1].kind).toEqual("Reaction") // wrapper reported, not Global
    dispose()
    disposeGlobal()
  })

  it("reports autorunAsync generator errors with kind AutorunAsync", async () => {
    const sink = jest.fn()
    registerMobxReactionErrorSink(sink)
    const callerOnError = jest.fn()
    const dispose = autorunAsync(
      function* () {
        yield Promise.resolve()
        throw new Error("generator boom")
      },
      { onError: callerOnError },
    )

    // autorunAsync starts asynchronously (fireAndForget); flush microtasks until it reports
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink.mock.calls[0][1].kind).toEqual("AutorunAsync")
    expect(callerOnError).toHaveBeenCalledTimes(1)
    dispose()
  })
})

// A computed MobX only learns about when the getter first runs: `doubled` defines itself with
// `extendObservable` on its first read, the way `@ga.computed` will once it materializes lazily.
// Until that read, `isComputedProp(host, "doubled")` reports a plain getter and
// `observe(host, "doubled")` cannot find an atom, which is the gap the facade's read-first
// wrappers close (MobX closed its own version in https://github.com/mobxjs/mobx/pull/4659).
class LazyComputedHost {
  base = 1

  constructor() {
    makeObservable(this, { base: observable })
  }

  private computeDoubled = (): number => this.base * 2

  get doubled(): number {
    const compute = this.computeDoubled
    extendObservable(
      this,
      {
        get doubled() {
          return compute()
        },
      },
      { doubled: computed },
    )
    return this.doubled
  }
}

const makeThrowingComputedHost = () =>
  makeObservable(
    {
      get boom(): number {
        throw new Error("first read fails")
      },
    },
    { boom: computed },
  )

describe("#observe", () => {
  it("observes a computed that is defined on its first read", () => {
    const host = new LazyComputedHost()
    const listener = jest.fn()
    const dispose = observe(host, "doubled", listener)

    runInAction(() => {
      host.base = 2
    })

    expect(listener).toHaveBeenCalledOnceWith(expect.objectContaining({ oldValue: 2, newValue: 4 }))
    dispose()
  })

  it("does not throw when the observed computed throws on its first evaluation", () => {
    silenceErrors(
      console,
      "error",
      expect.stringContaining("[mobx] Encountered an uncaught exception"),
    )
    const host = makeThrowingComputedHost()

    const dispose = observe(host, "boom", jest.fn())

    expect(isComputedProp(host, "boom")).toEqual(true)
    dispose()
  })

  it("passes object-level and map observers through", () => {
    const state = makeAutoObservable({ a: 1 })
    const objectListener = jest.fn()
    const disposeObject = observe(state, objectListener)
    const map = observable.map<string, number>({ k: 1 })
    const mapListener = jest.fn()
    const disposeMap = observe(map, "k", mapListener)

    runInAction(() => {
      state.a = 2
      map.set("k", 2)
    })

    expect(objectListener).toHaveBeenCalledOnceWith(expect.objectContaining({ name: "a" }))
    expect(mapListener).toHaveBeenCalledOnceWith(expect.objectContaining({ newValue: 2 }))
    disposeObject()
    disposeMap()
  })

  it("routes a property observer to a provider that stores the field itself", () => {
    const disposer = jest.fn()
    const provider = { value: 1, [observeFieldSymbol]: jest.fn().mockReturnValue(disposer) }
    const listener = jest.fn()

    const dispose = observe(provider, "value", listener, true)

    expect(provider[observeFieldSymbol]).toHaveBeenCalledOnceWith("value", listener, true)
    expect(dispose).toBe(disposer)
  })

  it("falls through to MobX when the provider declines the field", () => {
    class DecliningProvider {
      value = 1
      constructor() {
        makeObservable(this, { value: observable })
      }
      [observeFieldSymbol]() {
        return undefined
      }
    }
    const provider = new DecliningProvider()
    const listener = jest.fn()
    const dispose = observe(provider, "value", listener)

    runInAction(() => {
      provider.value = 2
    })
    dispose()

    expect(listener).toHaveBeenCalledOnceWith(expect.objectContaining({ newValue: 2 }))
  })

  it("rejects an object-level observer on a provider that stores fields itself", () => {
    const provider = { value: 1, [observeFieldSymbol]: () => undefined }

    expect(() => observe(provider, jest.fn())).toThrow(ObjectLevelModelObserveError)
  })

  it("adds no provider-key dependency to a derivation that observes an observable object", () => {
    const container = observable({ value: 1 })

    const dispose = autorun(() => {
      const disposeObserver = observe(container, jest.fn())
      disposeObserver()
    })
    const dependencyNames = pluck("name", getDependencyTree(dispose).dependencies ?? [])
    dispose()

    expect(dependencyNames).not.toContainEqual(expect.stringContaining("observeField"))
  })
})

describe("#extendObservable", () => {
  let provider: { [observeFieldSymbol]: () => undefined }
  beforeEach(() => {
    provider = { [observeFieldSymbol]: () => undefined }
    Object.defineProperty(provider, "value", {
      get: () => 1,
      set: () => {},
      enumerable: true,
      configurable: true,
    })
  })

  it("rejects a key a field observer provider keeps as its own accessor", () => {
    expect(() => extendObservable(provider, { value: 2 })).toThrow(FieldAccessorReplacedError)
  })

  it("adds a new key to a field observer provider", () => {
    const extended = extendObservable(provider, { extra: 1 })

    expect(isObservableProp(extended, "extra")).toEqual(true)
  })
})

describe("#isComputedProp", () => {
  it("reports a computed that is defined on its first read", () => {
    expect(isComputedProp(new LazyComputedHost(), "doubled")).toEqual(true)
  })

  it("reports a computed whose first evaluation throws, without throwing", () => {
    expect(isComputedProp(makeThrowingComputedHost(), "boom")).toEqual(true)
  })

  it("is false for data fields, plain objects and missing values", () => {
    expect(isComputedProp(new LazyComputedHost(), "base")).toEqual(false)
    expect(isComputedProp({ a: 1 }, "a")).toEqual(false)
    expect(isComputedProp(undefined, "a")).toEqual(false)
  })
})
