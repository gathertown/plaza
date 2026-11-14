import {
  _getGlobalState,
  _isComputingDerivation,
  $mobx,
  AnnotationsMap,
  autorun as autorunMobX,
  compareDefault,
  compareIdentity,
  compareShallow,
  compareStructural,
  CreateObservableOptions,
  extendObservable as extendObservableMobX,
  IAtom,
  IAutorunOptions,
  IReactionDisposer,
  IReactionOptions,
  IReactionPublic,
  isComputedProp as isComputedPropMobX,
  isObservableObject,
  Lambda,
  observe as observeMobX,
  reaction as reactionMobX,
  runInAction as runInActionMobX,
  untracked,
  when,
} from "mobx"

import {
  createErrorClass,
  deferredPromise,
  fireAndForget,
  isNil,
  isNotNil,
  isObject,
  just,
  MobXActionPerfTimelineRecorder,
  MobXPerfMetricAutorunWatcher,
  MobXPerfMetricReactionWatcher,
  MobXPerfMetricSideEffectWatcher,
  MobxReactionKind,
  reportMobxReactionError,
  suppressSyncError,
  VoidFunction,
} from "../helpers"
import { isProductionNodeEnv } from "./nodeEnv"

/**
 * Default onError for every wrapped reaction: report, then run the caller's handler, guarded so
 * an exception in it cannot reach MobX internals (a rethrowing handler permanently breaks the
 * reaction's reactivity). Installing onError also makes MobX skip its own console.error and the
 * global onReactionError handlers for this reaction, so wrapped sites report exactly once.
 */
const buildReportingOnError =
  (
    kind: MobxReactionKind,
    opts: { name?: string; onError?: (error: unknown) => void } | undefined,
  ) =>
  (error: unknown): void => {
    reportMobxReactionError(error, { reactionName: opts?.name ?? "Unknown", kind })
    suppressSyncError(() => opts?.onError?.(error))
  }

/**
 * Wrap MobX's `runInAction` to disallow async functions from being passed in.
 */
export type NoPromise<T> = T extends Promise<unknown> ? never : T
export const runInAction = <TReturn>(fn: () => NoPromise<TReturn>): TReturn => runInActionMobX(fn)

/**
 * Gather's wrapper around MobX's `reaction` that allows us to collect some metrics.
 */
export const reaction = <T, FireImmediately extends boolean = false>(
  expression: (r: IReactionPublic) => T,
  effect: (
    arg: T,
    prev: FireImmediately extends true ? T | undefined : T,
    r: IReactionPublic,
  ) => void,
  opts?: IReactionOptions<T, FireImmediately>,
): IReactionDisposer => {
  const optsWithReporting = {
    ...opts,
    onError: buildReportingOnError(MobxReactionKind.Reaction, opts),
  }

  if (!MobXPerfMetricReactionWatcher.isActive && !MobXActionPerfTimelineRecorder.isActive)
    return reactionMobX(expression, effect, optsWithReporting)

  const originalDisposer = reactionMobX(
    expression,
    (arg, prev, r) => {
      const start = performance.now()
      try {
        effect(arg, prev, r)
      } finally {
        const name = opts?.name ?? "Unknown"
        const duration = performance.now() - start

        if (MobXPerfMetricReactionWatcher.isActive) {
          MobXPerfMetricReactionWatcher.incrementTotalExecutionCount(name, duration)
        }

        if (MobXActionPerfTimelineRecorder.isActive) {
          MobXActionPerfTimelineRecorder.recordExecution(name, duration, "reaction")
        }
      }
    },
    optsWithReporting,
  )
  MobXPerfMetricReactionWatcher.incrementTotalCreatedCount()

  return countingDisposer(originalDisposer, MobXPerfMetricReactionWatcher)
}

/**
 * Creates a named reactive view and keeps it alive, so that the view is always
 * updated if one of the dependencies changes, even when the view is not further used by something else.
 *
 * (This is Gather's wrapper around MobX's `autorun` that allows us to collect some metrics.)
 *
 * @param view The reactive view
 * @returns disposer function, which can be used to stop the view from being updated in the future.
 */
export const autorun = (view: () => void, opts?: IAutorunOptions): IReactionDisposer => {
  const optsWithReporting = {
    ...opts,
    onError: buildReportingOnError(MobxReactionKind.Autorun, opts),
  }

  if (!MobXPerfMetricAutorunWatcher.isActive && !MobXActionPerfTimelineRecorder.isActive)
    return autorunMobX(view, optsWithReporting)

  const originalDisposer = autorunMobX(() => {
    const start = performance.now()
    try {
      view()
    } finally {
      const name = opts?.name ?? "Unknown"
      const duration = performance.now() - start

      if (MobXPerfMetricAutorunWatcher.isActive) {
        MobXPerfMetricAutorunWatcher.incrementTotalExecutionCount(name, duration)
      }

      if (MobXActionPerfTimelineRecorder.isActive) {
        MobXActionPerfTimelineRecorder.recordExecution(name, duration, "autorun")
      }
    }
  }, optsWithReporting)
  MobXPerfMetricAutorunWatcher.incrementTotalCreatedCount()

  return countingDisposer(originalDisposer, MobXPerfMetricAutorunWatcher)
}

/**
 * Wraps MobX's disposer so that disposing also counts toward `watcher`. It keeps the
 * `IReactionDisposer` shape: the reaction under `$mobx`, and `Symbol.dispose`, which MobX sets on
 * its own disposers and types.
 */
const countingDisposer = (
  originalDisposer: IReactionDisposer,
  watcher: MobXPerfMetricSideEffectWatcher,
): IReactionDisposer => {
  const dispose = () => {
    originalDisposer()
    watcher.incrementTotalDisposedCount()
  }
  return Object.assign(dispose, { [$mobx]: originalDisposer[$mobx], [Symbol.dispose]: dispose })
}

const AutoRunAsyncGeneratorRestartError = createErrorClass("AutoRunAsyncGeneratorRestartError")

/**
 * Wraps a generator function (that yields promises) inside a MobX `autorun` block
 */
export const autorunAsync = (
  view: () => Generator<Promise<unknown>>,
  opts?: Pick<IAutorunOptions, "onError">,
): VoidFunction => {
  const wrappedView = function* () {
    try {
      yield* view()
    } catch (e) {
      // don't bubble these up, just exit, these are used to restart the generator
      if (e instanceof AutoRunAsyncGeneratorRestartError) return
      reportMobxReactionError(e, {
        reactionName: "autorunAsync",
        kind: MobxReactionKind.AutorunAsync,
      })
      suppressSyncError(() => opts?.onError?.(e))
    }
  }
  const disposers: IReactionDisposer[] = []

  const disposeReactions = () => disposers.splice(0).forEach((disposer) => disposer())

  let currentGenerator: Generator | undefined
  let changed = 0

  // We have some async actions to perform here, but we can't make the top-level function async.
  // Wrap the async actions here.
  const restart = async () => {
    if (currentGenerator) {
      const oldGenerator = currentGenerator
      currentGenerator = undefined
      oldGenerator.throw(new AutoRunAsyncGeneratorRestartError("restart failed"))
    }

    disposeReactions()

    const gen = await trackReaction(wrappedView)
    if (currentGenerator) return // another autorunAsync was started before this one started, bail out
    currentGenerator = gen

    let next = await trackReaction(() => gen.next())

    while (!next.done) {
      try {
        const result = await next.value
        // got executed again, bail out, the generator was already aborted at the top of the method
        if (gen !== currentGenerator) return
        next = await trackReaction(() => gen.next(result))
      } catch (e) {
        next = await trackReaction(() => gen.throw(e))
      }
    }

    currentGenerator = undefined
  }

  const trackReaction = async <TReturn>(fn: () => TReturn) => {
    const { promise, resolve } = deferredPromise<TReturn>()
    // the reaction may not execute the 'expression' immediately so wrap it in a promise and
    // the side effect fn will not be executed unless the result of the 'expression' changes
    // between runs so always force a change with the incremented number
    disposers.push(
      reaction(
        () => {
          resolve(fn())
          return ++changed
        },
        restart,
        { name: "autorunAsync.trackReaction" },
      ),
    )
    return promise
  }

  fireAndForget(restart, "Failed to restart generator")

  return disposeReactions
}

/**
 * Wrapper for MobX `autorun`.
 * Accepts a view that returns a cleanup callback, and calls the cleanup callback before each run.
 * The returned disposer function calls both the autorun disposer and the cleanup callback.
 */
export const autorunWithCleanup = (
  view: () => VoidFunction,
  opts?: IAutorunOptions,
): VoidFunction => {
  let cleanupCallback: VoidFunction | undefined
  const disposer = autorun(
    () => {
      cleanupCallback?.()
      cleanupCallback = view()
    },
    { ...opts, name: opts?.name ?? "autorunWithCleanup" },
  )

  return () => {
    cleanupCallback?.()
    disposer()
  }
}

/**
 * Wrapper for MobX `reaction`.
 * Accepts an effect that returns a cleanup callback, and calls the cleanup callback before each
 * run. The returned disposer function calls both the reaction disposer and the cleanup callback.
 */
export const reactionWithCleanup = <T, FireImmediately extends boolean = false>(
  expression: (r: IReactionPublic) => T,
  effect: (
    arg: T,
    prev: FireImmediately extends true ? T | undefined : T,
    r: IReactionPublic,
  ) => VoidFunction,
  opts?: IReactionOptions<T, FireImmediately>,
) => {
  let cleanupCallback: VoidFunction | undefined
  const disposer = reaction(
    expression,
    (arg, prev, r) => {
      cleanupCallback?.()
      cleanupCallback = effect(arg, prev, r)
    },
    { ...opts, name: opts?.name ?? "reactionWithCleanup" },
  )

  return () => {
    cleanupCallback?.()
    disposer()
  }
}

type CancellablePromise<T> = Promise<T> & { cancel(): void }

/**
 * Waits for `predicate` to return a defined value, then resolves with that value.
 *
 * @param predicate A function that returns the value to wait for.
 * @return A promise with a `.cancel()` method that cancels the waiting.
 */
export const waitForExistence = <T>(
  predicate: () => T | null | undefined,
): CancellablePromise<T> => {
  const promise = when(() => isNotNil(predicate()), { name: "waitForExistence" })
  const deferred = deferredPromise<T>()
  promise
    .then(() =>
      deferred.resolve(
        just(predicate(), "Expected predicate value after waitForExistence condition became true"),
      ),
    )
    .catch(deferred.reject)

  // We'll add the `cancel()` interface on immediately below
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const retPromise = deferred.promise as CancellablePromise<T>
  retPromise.cancel = () => promise.cancel()

  return retPromise
}

/**
 * Resolves true once `predicate` returns true, or false if `signal` aborts first. `when` rejects on
 * abort, which turns a routine shutdown into an error at every call site.
 */
export const waitUntil = async (
  predicate: () => boolean,
  { signal, name }: { signal: AbortSignal; name?: string },
): Promise<boolean> => {
  try {
    await when(predicate, { signal, name })
    return true
  } catch (error) {
    if (signal.aborted) return false
    throw error
  }
}

/**
 * Wraps a promise in a typed generator. Useful in places like `autorunAsync()` to improve typing in some situations
 * where the simpler `yield promise` wouldn't work.
 * Usage:
 *
 *     yield* yieldPromise(promise)
 */
export function yieldPromise<T>(value: Promise<T>): Generator<Promise<T>, T, T>
export function yieldPromise<T>(
  value: Promise<T> | undefined,
): Generator<Promise<T>, T | undefined, T>
// eslint-disable-next-line func-style -- TS overloads need a function declaration
export function* yieldPromise<T>(
  value: Promise<T> | undefined,
): Generator<Promise<T>, T | undefined, T> {
  if (isNil(value)) return undefined
  return yield value
}

export const resolveGenerator = <T, R>(generator: Generator<Promise<T>, R, T>): Promise<R> => {
  const process = (result: IteratorResult<Promise<T>, R>): Promise<R> => {
    if (result.done) return Promise.resolve(result.value)

    return result.value.then((value) => process(generator.next(value)))
  }
  return process(generator.next())
}
/**
 * clears an object of all keys, triggering MobX reactivity
 */
export const clearObject = <T extends Record<string, unknown>>(obj: T): void => {
  for (const key in obj) {
    delete obj[key]
  }
}

const noop = (..._deps: unknown[]) => {}
const markDepsWithValidation = (...deps: unknown[]) => {
  deps.forEach((dep, i) => {
    // There's not that much validation we can actually do because computeds could return literally anything... even functions.
    // Functions specifically should be rare enough to return from computeds that we can just throw an error if we see one.
    if (typeof dep === "function") {
      throw new Error(
        `markDeps() received function dep ${dep} at index ${i}! You don't need to mark functions you're calling as deps, since they aren't observables. If you're returning a function from a computed, manually mark it separately.`,
      )
    }
  })
}

/**
 * A helper function used to access getters on MobX observables to "mark" them as dependencies in the
 * current `autorun` (or other derivation). This is just syntax sugar - seeing the words `markDeps()`
 * helps readers understand what you're doing (referencing those observables).
 *
 * This function is a no-op in production builds, and runs validation checks everywhere else.
 *
 * Example usage:
 *
 *     // Inside an `autorun()` somewhere...
 *      markDeps(member.currentRoom) // explicitly tell MobX to react to this
 *      runInAction(() => {
 *        // Anything inside here will NOT cause the autorun to react
 *        this.doStuff()
 *      })
 *
 * @param deps MobX observables to mark as dependencies for the current derivation (e.g. `autorun`, `reaction`)
 */
export const markDeps = isProductionNodeEnv() ? noop : markDepsWithValidation

// Simple wrapper to generate setters without using 4 lines each time
export const createSetterFor =
  <T, K extends keyof T>(thisArg: T, prop: K) =>
  (value: T[K]): void => {
    runInAction(() => {
      thisArg[prop] = value
    })
  }

export { computedFn } from "./vendor/computedFn"

/**
 * Re-exported so call sites reach these through the facade rather than importing `mobx` directly,
 * which is what kept the 6→7 rename of all three to a single edit in this file.
 */
export { actionBound, flowBound, observableRef } from "mobx"

/**
 * MobX 7 exposes four bare comparer functions instead of a `comparer` object. This object keeps
 * the `comparer.*` call sites working unchanged.
 *
 * Do not re-type the members (`shallow: <T>(a: T, b: T) => ...`). MobX types these as
 * `(a: any, b: any) => boolean`, and `@ga.computed.equals()` infers `TValue` from the comparer,
 * so a generic wrapper would silently move that inference from `any` to `unknown`.
 */
export const comparer = {
  default: compareDefault,
  identity: compareIdentity,
  shallow: compareShallow,
  structural: compareStructural,
}

export type {
  AnnotationsMap,
  IArrayWillChange,
  IArrayWillSplice,
  IAtom,
  IAutorunOptions,
  IObjectDidChange,
  IObservableArray,
  IObservableValue,
  IReactionDisposer,
  IReactionOptions,
  ISetWillChange,
} from "mobx"

/**
 * Per-property introspection sees a computed only after it exists. `@ga.computed` materializes on
 * first read (`createLazyComputedGetter`), so this read happens first, untracked. Errors stay on
 * `observe`'s reaction or the caller's next read: a throw from here is swallowed by `applyPatches`.
 *
 * MobX does the same one layer down: `getAtom` reads the property before looking for its atom so
 * that fields without a default value can be observed (mobxjs/mobx#1072), and when its decorator
 * computeds became lazy it taught `isComputedProp` to materialize before answering
 * (https://github.com/mobxjs/mobx/pull/4659). Our computeds are not registered with MobX before
 * their first read, so the same fix has to live here.
 */
const materializeLazyComputedByReading = (thing: unknown, property: PropertyKey): void => {
  if (!isObservableObject(thing)) return
  try {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    untracked(() => (thing as Record<PropertyKey, unknown>)[property])
  } catch {
    /* swallow */
  }
}

/**
 * An object that keeps some of its fields outside MobX's administration defines this member, so
 * `observe(object, key, listener)` still reaches those fields. The member returns `undefined` for
 * a key it does not keep, and `observe` then falls through to MobX for computeds and other
 * observable members.
 */
export const observeFieldSymbol = Symbol("observeField")
export type FieldObserverProvider = {
  [observeFieldSymbol]?: (
    key: PropertyKey,
    listener: (change: unknown) => void,
    fireImmediately: boolean,
  ) => Lambda | undefined
}

export const ObjectLevelModelObserveError = createErrorClass("ObjectLevelModelObserveError")

export const FieldAccessorReplacedError = createErrorClass<{ key: string }>(
  "FieldAccessorReplacedError",
)

/**
 * True while a MobX derivation, an autorun, reaction or computed, collects its dependencies, so a
 * read should subscribe it.
 */
export const isInsideDerivation = (): boolean => _isComputingDerivation()

/**
 * The strict-mode warning for a write outside an action. MobX runs it in `ObservableValue.set`,
 * and a bare atom's `reportChanged` has no such check. It misses an equal-value write, which a
 * field setter returns from before reporting a change. In the test-only modes it also misses a field no
 * derivation has read under `"always"` and MobX's other wording under `"never"`.
 */
export const warnOnObservedWriteOutsideAction = (atom: IAtom): void => {
  // MobX strips its own check from production builds.
  if (process.env.NODE_ENV === "production") return
  const state = _getGlobalState()
  if (state.allowStateChanges) return
  // MobX 7 leaves `observers_` null until the first observer subscribes.
  const needsAction = (atom.observers_?.size ?? 0) > 0 || state.enforceActions === "always"
  if (!needsAction) return
  console.warn(
    `[MobX] Since strict-mode is enabled, changing (observed) observable values without using an action is not allowed. Tried to modify: ${atom.name_}`,
  )
}

// On a MobX object proxy, `in` and a property read hit traps that record a pending key inside a
// derivation, which MobX never deletes. Neither `Object.hasOwn` nor `Object.getPrototypeOf` goes
// through a trap, so this check records nothing.
const isFieldObserverProvider = (thing: unknown): thing is FieldObserverProvider =>
  isObject(thing) && (Object.hasOwn(thing, observeFieldSymbol) || inheritsFieldObserver(thing))

const inheritsFieldObserver = (thing: object): boolean => {
  const prototype: unknown = Object.getPrototypeOf(thing)
  return isObject(prototype) && observeFieldSymbol in prototype
}

/**
 * MobX's `extendObservable` would replace a field a field observer provider keeps as its own
 * accessor, and writes to the field would then stop reaching the provider. MobX itself throws
 * for a key that is already observable, which is how a plain MobX object behaves.
 */
export const extendObservable = <A extends object, B extends object>(
  target: A,
  properties: B,
  annotations?: AnnotationsMap<B, never>,
  options?: CreateObservableOptions,
): A & B => {
  if (isFieldObserverProvider(target)) {
    const replacedKey = Object.keys(properties).find((key) =>
      isNotNil(Object.getOwnPropertyDescriptor(target, key)?.get),
    )
    if (isNotNil(replacedKey)) {
      throw new FieldAccessorReplacedError("extendObservable would replace a field accessor", {
        key: replacedKey,
      })
    }
  }
  return extendObservableMobX(target, properties, annotations, options)
}

const observeFieldOnProvider = (
  thing: unknown,
  key: unknown,
  listener: unknown,
  fireImmediately: boolean,
): Lambda | undefined => {
  if (!isFieldObserverProvider(thing)) return undefined
  // MobX's `observe` overloads pass the key and the listener as `unknown`, so this narrows them once.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const [fieldKey, fieldListener] = [key, listener] as [PropertyKey, (change: unknown) => void]
  return thing[observeFieldSymbol]?.(fieldKey, fieldListener, fireImmediately)
}

/**
 * Property-key overload only. Object, array, set, and map observers do not need a read first.
 */
export const observe: typeof observeMobX = (
  thing: unknown,
  propertyOrListener: unknown,
  ...rest: unknown[]
): Lambda => {
  if (typeof propertyOrListener !== "function") {
    const fieldDisposer = observeFieldOnProvider(
      thing,
      propertyOrListener,
      rest[0],
      rest[1] === true,
    )
    if (fieldDisposer) return fieldDisposer
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    materializeLazyComputedByReading(thing, propertyOrListener as PropertyKey)
  } else if (isFieldObserverProvider(thing)) {
    throw new ObjectLevelModelObserveError(
      "A model's data fields have no MobX administration entries, so an object-level observe would miss them. Observe each field with observe(object, key, listener).",
    )
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return (observeMobX as (...args: unknown[]) => Lambda)(thing, propertyOrListener, ...rest)
}

export const isComputedProp: typeof isComputedPropMobX = (value, propName) => {
  materializeLazyComputedByReading(value, propName)
  return isComputedPropMobX(value, propName)
}

export {
  $mobx,
  action,
  createAtom,
  flow,
  getObserverTree,
  intercept,
  isComputed,
  isObservable,
  isObservableMap,
  isObservableProp,
  isObservableSet,
  makeAutoObservable,
  makeObservable,
  observable,
  ObservableMap,
  ObservableSet,
  toJS,
  untracked,
  when,
} from "mobx"
