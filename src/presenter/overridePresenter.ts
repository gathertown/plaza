import { isUndefined } from "../helpers"
import { extendObservable, ga } from "../mobx"
import { AsyncState } from "./AsyncState"
import { BasePresenter } from "./BasePresenter"
import { AnyAsyncState, MinimalPresenter, MinimalPresenterInstance } from "./presenterHelpers"
import { createPresenterOverrideEntry, PresenterOverrideEntry } from "./PresenterOverridesContext"

// Lifecycle methods, asyncDeps, etc. that come from BasePresenter, plus the `afterObservable` hook
// that @ga.observableClass calls on a presenter that defines one.
type PresenterInfraKeys =
  | keyof InstanceType<ReturnType<ReturnType<typeof BasePresenter>>>
  | "afterObservable"

// The presenter's own view-model members. Required, not Partial: a story that omits a field the
// component reads should fail to compile, not silently render undefined.
export type PresenterMockFields<T extends {}> = Omit<T, PresenterInfraKeys>

export type PresenterMockLifecycle = {
  // "forever": a never-resolving AsyncState — static suspense-fallback story. A Promise: the story
  // suspends until it resolves, then renders loaded content. Unset: loaded immediately.
  loading?: "forever" | Promise<unknown>
  afterMount?: () => void | Promise<void>
  afterMountOrPropChange?: () => void | Promise<void>
  onDestroy?: () => void
}

// The state is built once per override entry (not per mock): a component that suspends on first render
// never commits, so its usePresenter useState initializer — and thus this factory — re-runs on
// every retry. A fresh pending AsyncState each time would never settle. rawAsyncDeps is also a
// computed that re-evaluates when unobserved, so the returned instance must be stable there too.
export const buildLoadingState = (
  loading: PresenterMockLifecycle["loading"],
): AnyAsyncState | undefined =>
  isUndefined(loading)
    ? undefined
    : new AsyncState(AsyncState.neverDestroyed, () =>
        loading === "forever" ? new Promise<never>(() => {}) : loading,
      )

// One mock per factory invocation, i.e. per usePresenter hook. Uses a real BasePresenter.
// Story's presenter field values are layered on top.
export const buildMockPresenter = <T extends {}, A extends Record<string, unknown>>(
  presenterProps: A,
  fields: PresenterMockFields<T>,
  lifecycle: PresenterMockLifecycle,
  loadingState: AnyAsyncState | undefined,
): MinimalPresenterInstance<T, A> => {
  const { afterMount, afterMountOrPropChange, onDestroy } = lifecycle

  const asyncDependencies = isUndefined(loadingState)
    ? undefined
    : () => ({ storyLoading: loadingState })

  // A fresh observable subclass per mock: subclassing an observable BasePresenter requires the
  // subclass be observable too, and @ga.observableClass needs a class declaration to attach to.
  @ga.observableClass
  class MockPresenter extends BasePresenter<A>()(asyncDependencies) {}

  const mock = new MockPresenter(presenterProps)
  if (!isUndefined(afterMountOrPropChange)) {
    mock.afterMountOrPropChange = afterMountOrPropChange
  }

  // Register onDestroy inside afterMount (which BasePresenter re-runs each mount) so it survives
  // StrictMode's mount -> destroy -> mount; a destructor added once at construction is consumed by
  // the first (fake) cleanup.
  if (!isUndefined(afterMount) || !isUndefined(onDestroy)) {
    mock.afterMount = () => {
      if (!isUndefined(onDestroy)) {
        mock.addDestructor(onDestroy)
      }
      return afterMount?.()
    }
  }

  // Make the story's fields observable (mutations re-render observers — live args rely on this) and
  // preserve supplied getters as computeds.
  extendObservable(mock, fields)

  // The story's typed fields are the only part of T the base doesn't provide, so the structural
  // overlap check can't see it; go through unknown.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return mock as unknown as MinimalPresenterInstance<T, A>
}

// The typed boundary. T/A infer from PresenterClass only (NoInfer on the fields), so a nonexistent
// field fails typechecking.
export const overridePresenter = <T extends {}, A extends Record<string, unknown>>(
  PresenterClass: MinimalPresenter<T, A>,
  buildFields: (presenterProps: A) => PresenterMockFields<NoInfer<T>>,
  lifecycle: PresenterMockLifecycle = {},
): PresenterOverrideEntry => {
  const loadingState = buildLoadingState(lifecycle.loading)
  const factory = (presenterProps: A) =>
    buildMockPresenter(presenterProps, buildFields(presenterProps), lifecycle, loadingState)
  return createPresenterOverrideEntry(PresenterClass, factory)
}
