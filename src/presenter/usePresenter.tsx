import { useEffect, useMemo, useState } from "react"

import { fireAndForget } from "../helpers"
import { MinimalPresenter } from "./presenterHelpers"
import { resolvePresenterOverride, usePresenterOverrides } from "./PresenterOverridesContext"

export const usePresenter = <T extends {}, A extends Record<string, unknown>>(
  PresenterClass: MinimalPresenter<T, A>,
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  presenterProps: A = {} as A,
): { presenter: T } => {
  const overrides = usePresenterOverrides()
  const [presenter] = useState(() =>
    resolvePresenterOverride(PresenterClass, presenterProps, overrides),
  )

  useEffect(() => {
    // `afterMountBase` flushes subscriptions queued by `this.reaction` / `this.autorun`
    // (synchronously, before any user `await`) and then invokes the user's `afterMount`.
    // Wrapping in `fireAndForget` plus `Promise.resolve` handles
    // both the void and the async-`afterMount` cases, ensuring we don't drop rejected promises.
    fireAndForget(Promise.resolve(presenter.afterMountBase()), "Presenter afterMountBase failed")
    return () => {
      presenter.destroy()
    }
  }, [presenter])

  const presenterPropValues = Object.values(presenterProps)
  // Typically one would use `useEffect` to react to changes, but we want the props to sync BEFORE
  // the component gets rendered. This could actually just be called directly outside of this hook,
  // but since we want to compare if props changed we use `useMemo` as a convenient way to do this.
  useMemo(() => {
    presenter.syncProps(presenterProps)

    // Only sync if prop values change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...presenterPropValues])

  // Trigger class method to perform presenter side effects after mount or prop change. This should
  // happen in a useEffect specifically because it's for side effects.
  useEffect(
    () => {
      // `afterMountOrPropChangeBase` is synchronous so that throws in `afterMountOrPropChange`
      // propagate out of the effect and reach React's error boundary, matching how `afterMountBase`
      // works. Wrapping in `Promise.resolve` normalises the void/Promise return so that async
      // rejections are still caught by `fireAndForget`.
      fireAndForget(
        Promise.resolve(presenter.afterMountOrPropChangeBase()),
        "Presenter afterMountOrPropChangeBase failed",
      )
      return presenter.destroyAfterMountOrOnPropChangeDestructors
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [presenter, ...presenterPropValues],
  )

  // Throw the load promise. The nearest suspense boundary will catch it.
  if (!presenter.asyncDepsLoaded) throw presenter.reloadOnPropChange()

  return { presenter }
}
