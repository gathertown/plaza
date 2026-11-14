import { isUndefined, suppressError, VoidFunction } from "../helpers"
import {
  autorun as mobxAutorun,
  Destructible,
  ga,
  IAutorunOptions,
  IReactionOptions,
  reaction as mobxReaction,
  runInAction,
  untracked,
} from "../mobx"
import { AsyncState } from "./AsyncState"
import { AnyAsyncState, AsyncStateDataFromDeps, AsyncStateDeps } from "./presenterHelpers"

export const BasePresenter =
  <T extends object>() =>
  <D extends AsyncStateDeps>(asyncDependencies?: (props: T) => D) => {
    type BasePresenterPublic = {
      props: T
      get rawAsyncDeps(): D
      get asyncDeps(): AsyncStateDataFromDeps<D>
      syncProps(props: T): Promise<AnyAsyncState[]>
      get asyncDepsLoaded(): boolean
      reloadOnPropChange(): Promise<unknown[]>
      afterMount(): void | Promise<void>
      afterMountBase(): void | Promise<void>
      afterMountOrPropChange(): void | Promise<void>
      afterMountOrPropChangeBase(): void | Promise<void>
      destroyAfterMountOrOnPropChangeDestructors(): void
      reaction<U>(
        expression: () => U,
        effect: (val: U, prev: U | undefined) => void,
        options?: IReactionOptions<U, boolean> & { withProps?: boolean },
      ): void
      autorun(view: () => void, options?: IAutorunOptions & { withProps?: boolean }): void
    } & Destructible

    @ga.observableClass.exclude([
      "props",
      "lifecyclePhase",
      "isInAfterMountOrPropChangeBase",
      "afterMountOrPropChangeBaseDestructors",
      "deferredMountSubscriptions",
      "deferredMountDestructors",
      "deferredPropChangeEntries",
      "propChangeSubscriptionDestructors",
    ])
    class BasePresenter extends Destructible implements BasePresenterPublic {
      private lifecyclePhase: "constructing" | "mounted" | "destroyed" = "constructing"

      private isInAfterMountOrPropChangeBase = false

      // Destructors from the user's afterMountOrPropChange override. Torn down on every React
      // effect cleanup cycle.
      private afterMountOrPropChangeBaseDestructors: VoidFunction[] = []

      // Subscription setup closures queued by this.reaction/autorun (mount-only path).
      // Written once at construction, re-run on each afterMountBase call (StrictMode remount).
      private deferredMountSubscriptions: (() => VoidFunction)[] = []

      // Live destructors from mount-only subscriptions. Torn down at the start of each
      // afterMountBase call (to handle StrictMode remount) and on destroy.
      private deferredMountDestructors: VoidFunction[] = []

      // Subscription entries queued by this.reaction/autorun (withProps path). Written once
      // at construction, re-run when props change. runInitialSync re-seeds state before the
      // subscription takes over; for autorun it's a no-op since autorun fires on registration.
      private deferredPropChangeEntries: Array<{
        runInitialSync: () => void
        setupSubscription: () => VoidFunction
      }> = []

      // Live destructors from withProps subscriptions. Torn down and re-registered on each
      // afterMountOrPropChangeBase call, matching how mount-only subscriptions work.
      private propChangeSubscriptionDestructors: VoidFunction[] = []

      constructor(public props: T) {
        super()
      }

      get rawAsyncDeps(): D {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        if (isUndefined(asyncDependencies)) return {} as D

        return asyncDependencies(this.props)
      }

      /**
       * Extracts the data from AsyncState so that it can be used directly without needing to call
       * `dataOrThrow`. This works because the presenter generally only allows access to deps after
       * it has loaded. For cases where we need to access deps before they're loaded, or we want to
       * add custom handling for deps that hit an error state, deps need to be accessed via
       * `rawAsyncDeps` otherwise an error will be thrown.
       */
      get asyncDeps(): AsyncStateDataFromDeps<D> {
        return Object.entries(this.rawAsyncDeps).reduce(
          (loadedDeps, [key, value]) => {
            // Since this type is a generic, we have to tell TS that it's just a standard map with
            // keys as strings.
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            const assignableLoadedDeps = loadedDeps as Record<string, unknown>

            if (value instanceof AsyncState) {
              // TODO Handle error state (when the data failed to load) and throw or
              // format a more custom error for the error boundary.
              assignableLoadedDeps[key] = value.dataOrThrow

              return loadedDeps
            }

            assignableLoadedDeps[key] = value
            return loadedDeps
          },
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          {} as AsyncStateDataFromDeps<D>,
        )
      }

      // Sync props is called initially as well as any time the props change. Note that props are
      // not observable, so they won't work in computeds. Presenters have to use
      // `@ga.presenter.computed_DO_NOT_USE_PROPS` to indicate that they're using a computed that
      // doesn't use props. If you want to react to changes in props, use `afterMountOrPropChange`.
      async syncProps(props: T): Promise<AnyAsyncState[]> {
        Object.assign(this.props, props)

        // Tear down withProps subscriptions so afterMountOrPropChangeBase can re-subscribe with
        // fresh prop values on its next call.
        this.destroyPropChangeSubscriptions()

        // Reload presenter data when props change since the dependencies can take in props and
        // therefore can change based on the props.
        return this.reloadOnPropChange()
      }

      get asyncDepsLoaded() {
        return Object.values(this.rawAsyncDeps).every((dep) => dep.isSuccess())
      }

      async reloadOnPropChange(): Promise<AnyAsyncState[]> {
        return Promise.all(
          Object.values(this.rawAsyncDeps).map(async (asyncDep) => {
            if (asyncDep instanceof AsyncState) {
              await asyncDep.ensureLoaded()
            }

            return asyncDep
          }),
        )
      }

      // May be overridden to provide behavior that occurs after mount. This is good for triggering
      // async side effects after mounting or using asyncDeps (which are unavailable in `constructor`).
      // This is roughly equivalent to `useEffect(() => {}, [])`, in that it runs only once when
      // the component is first mounted, can be async, and can trigger side effects like loading
      // external state or changing global state. It's important to remember that presenters are not
      // hooks, so the analogy is limited.
      //
      // Why have both an afterMount and afterMountOrPropChange when the latter is a superset of
      // the former? We wanted to avoid a class of bugs where we start with a presenter without
      // props, put state initialization into afterMountOrPropChange assuming it runs only once,
      // and then later props are added that trigger multiple times. By having an afterMount,
      // we can specifically indicate we want this to run only once.
      //
      // There's a downside, where people may end up referencing `this.props` in afterMount and that
      // is quite possibly by mistake (thinking it's reactive). We can have an eslint rule that
      // imperfectly guards against it, but it won't be 100%. It still seemed worth this risk
      // because it seemed like less of a risk than the category of bug mentioned above.
      // For async work, use fireAndForget(this.myAsyncMethod()) — don't return a promise or use
      // .then() chains, since the lifecycle scoping only applies to the synchronous portion.
      afterMount() {}

      // Called by `usePresenter` from a `useEffect`. (Re-)registers any subscriptions queued by
      // `this.reaction` / `this.autorun` and then invokes
      // the user's `afterMount`. Only runs for the React-committed presenter; orphan presenters
      // from discarded concurrent renders never get here, so their queued subscriptions are never
      // registered. Returns the user's `afterMount` result so an async `afterMount` Promise
      // propagates to the caller. Subscription registration is synchronous and happens before the
      // user's body, so `afterMount` sees a presenter with the listeners attached.
      //
      // The queued setup functions are NOT consumed: they may be re-run on a subsequent mount.
      afterMountBase(): void | Promise<void> {
        this.destroyDeferredMountDestructors()
        // React StrictMode cycles useEffect mount → cleanup → mount → unmount on the same
        // presenter. The cleanup calls destroy(), which sets _isDestroyed and would cause the
        // second mount's destroy() to no-op, leaking any destructors registered during the
        // second afterMount. Resetting here re-enables destroy() for the next unmount. On the
        // first mount this is a no-op (already false). Placed after teardown so that cleanup
        // runs while still "destroyed", and before re-registration so the presenter is "alive"
        // when subscriptions and afterMount() run.
        this.resetDestroyed()
        // On a hot path, use `for...of` loop for performance
        for (const setupSubscription of this.deferredMountSubscriptions) {
          this.deferredMountDestructors.push(setupSubscription())
        }
        this.lifecyclePhase = "mounted"
        return this.afterMount()
      }

      destroyDeferredMountDestructors = () => {
        // On a hot path, use `for...of` loop for performance
        for (const dispose of this.deferredMountDestructors) {
          try {
            dispose()
          } catch (e) {
            console.error("Error while tearing down deferredMount destructor", e)
          }
        }
        this.deferredMountDestructors = []
      }

      // Compute a value from observables and apply it to a local state, with ongoing reactivity
      // once the component mounts. Use this in `afterObservable` (or a constructor).
      //
      // When `fireImmediately: true` is passed, the effect fires synchronously at registration
      // (wrapped in `untracked` so reads don't leak as deps) to seed state before the first
      // render. Without it, no initial sync runs — the first fire happens after the subscription
      // registers in afterMountBase and then a change is detected.
      reaction<U>(
        expression: () => U,
        effect: (val: U, prev: U | undefined) => void,
        options?: IReactionOptions<U, boolean> & { withProps?: boolean },
      ): void {
        if (this.lifecyclePhase === "destroyed") {
          console.warn("Attempted to add listener to destroyed presenter", {
            presenter: this.constructor.name,
          })
          return
        }

        if (this.lifecyclePhase === "mounted") {
          const { withProps: _, ...mobxOpts } = options ?? {}
          const disposer = mobxReaction(expression, effect, mobxOpts)
          this.addDestructors(disposer)
          return
        }

        if (options?.fireImmediately) {
          runInAction(() => effect(untracked(expression), undefined))
        }
        const reactionName = options?.name ?? "reaction"
        const {
          withProps,
          fireImmediately: _fireImmediately,
          ...mobxReactionOptions
        } = options ?? {}
        const wrappedEffect = (val: U, prev: U | undefined) => runInAction(() => effect(val, prev))

        if (withProps) {
          // withProps path: runInitialSync re-runs in afterMountOrPropChangeBase to catch values
          // that changed between construction and mount (only when fireImmediately is set).
          this.deferredPropChangeEntries.push({
            runInitialSync: options?.fireImmediately
              ? () => effect(untracked(expression), undefined)
              : () => {},
            setupSubscription: () =>
              mobxReaction(expression, wrappedEffect, {
                ...mobxReactionOptions,
                name: reactionName,
              }),
          })
        } else {
          // Mount-only path: passes the caller's fireImmediately to mobx's reaction so it
          // re-evaluates on registration, catching any drift between construction and mount.
          this.deferredMountSubscriptions.push(() =>
            mobxReaction(expression, wrappedEffect, {
              ...mobxReactionOptions,
              name: reactionName,
              fireImmediately: options?.fireImmediately,
            }),
          )
        }
      }

      // `autorun`-shaped counterpart to `this.reaction`.
      //
      // Note that `effect` runs twice on initial setup: once synchronously (to seed state before
      // first render), and once when `autorun` registers (mandatory — `autorun` always fires on
      // registration to establish dependencies). Idempotent state-derivation views are unaffected.
      // The deferred autorun does NOT wrap `effect` in `runInAction` because mobx actions suppress
      // tracking, which would defeat `autorun`'s reactivity.
      autorun(effect: () => void, options?: IAutorunOptions & { withProps?: boolean }): void {
        if (this.lifecyclePhase === "destroyed") {
          console.warn("Attempted to add listener to destroyed presenter", {
            presenter: this.constructor.name,
          })
          return
        }

        if (this.lifecyclePhase === "mounted") {
          const { withProps: _, ...mobxOpts } = options ?? {}
          const disposer = mobxAutorun(effect, mobxOpts)
          this.addDestructors(disposer)
          return
        }

        runInAction(() => untracked(effect))
        const autorunName = options?.name ?? "autorun"
        const { withProps, ...mobxAutorunOptions } = options ?? {}
        const setupSubscription = () =>
          mobxAutorun(effect, { ...mobxAutorunOptions, name: autorunName })

        if (withProps) {
          this.deferredPropChangeEntries.push({
            // autorun always fires on registration, so runInitialSync is a no-op here.
            runInitialSync: () => {},
            setupSubscription,
          })
        } else {
          this.deferredMountSubscriptions.push(setupSubscription)
        }
      }

      // May be overridden to provide behavior that occurs after mount or when any prop changes
      // as an effect after the render. This is good for async side effects or setting up listeners
      // that rely on reacting to prop changes (because props are not observable).
      //
      // For async work, use fireAndForget(this.myAsyncMethod()) — don't return a promise or use
      // .then() chains, since the lifecycle scoping only applies to the synchronous portion.
      afterMountOrPropChange() {}

      // This should only be called by the `usePresenter`. It does some additional metadata tracking
      // so we can properly tear down listeners created during this phase at the right time.
      //
      // Non-async so that synchronous throws in `afterMountOrPropChange` propagate to the caller
      // and reach React's error boundary, matching the behavior of `afterMountBase`. Async
      // rejections still propagate because `usePresenter` wraps the result in `Promise.resolve`
      // before passing it to `fireAndForget`.
      afterMountOrPropChangeBase(): void | Promise<void> {
        this.destroyPropChangeSubscriptions()
        for (const entry of this.deferredPropChangeEntries) {
          runInAction(() => untracked(entry.runInitialSync))
          this.propChangeSubscriptionDestructors.push(entry.setupSubscription())
        }

        runInAction(() => (this.isInAfterMountOrPropChangeBase = true))
        try {
          return this.afterMountOrPropChange()
        } finally {
          runInAction(() => (this.isInAfterMountOrPropChangeBase = false))
        }
      }

      // Override to make addDestructor(s) context-aware: destructors registered during
      // afterMountOrPropChange are scoped to the prop-change cycle, not the presenter lifetime.
      override addDestructor(destructor: VoidFunction) {
        if (!this.isInAfterMountOrPropChangeBase) return super.addDestructor(destructor)
        this.afterMountOrPropChangeBaseDestructors.push(destructor)
      }

      override addDestructors(...destructors: VoidFunction[]) {
        if (!this.isInAfterMountOrPropChangeBase) return super.addDestructors(...destructors)
        // noinspection JSPotentiallyInvalidUsageOfThis -- it's fine, WS is smoking
        this.afterMountOrPropChangeBaseDestructors.push(...destructors)
      }

      destroyAfterMountOrOnPropChangeDestructors = () => {
        if (this.isDestroyed) return
        this.afterMountOrPropChangeBaseDestructors.forEach((f) =>
          suppressError(f, (e) =>
            console.error("Error while tearing down afterMountOrPropChange destructor", e),
          ),
        )
        this.afterMountOrPropChangeBaseDestructors = []
      }

      destroyPropChangeSubscriptions = () => {
        for (const dispose of this.propChangeSubscriptionDestructors) {
          suppressError(dispose, (e) =>
            console.error("Error while tearing down propChange subscription", e),
          )
        }
        this.propChangeSubscriptionDestructors = []
      }

      // Override to clean up `afterMountOrPropChange` destructors before cleaning up the "regular"
      // ones. Without this, we'd attempt to clean up `afterMountOrPropChange` destructors too late,
      // and the presenter would already be considered destroyed and skip it.
      override destroy() {
        this.destroyAfterMountOrOnPropChangeDestructors()
        this.destroyPropChangeSubscriptions()
        this.destroyDeferredMountDestructors()
        super.destroy()
        this.lifecyclePhase = "destroyed"
      }
    }

    // We need to redundantly define `BasePresenterPublic` separately to use
    // private/protected fields inside `BasePresenter`, otherwise TS will complain because
    // this is being returned from a factory.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return BasePresenter as new (
      ...args: ConstructorParameters<typeof BasePresenter>
    ) => BasePresenterPublic
  }
