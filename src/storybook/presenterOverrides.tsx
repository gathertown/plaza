import { ComponentType, ReactElement, useContext, useLayoutEffect, useRef, useState } from "react"

import { isUndefined } from "../helpers"
import { runInAction } from "../mobx"
import {
  buildLoadingState,
  buildMockPresenter,
  overridePresenter,
  PresenterMockFields,
  PresenterMockLifecycle,
} from "../presenter/overridePresenter"
import { MinimalPresenter } from "../presenter/presenterHelpers"
import {
  createPresenterOverrideEntry,
  presenterClassName,
  PresenterOverrideEntry,
  PresenterOverrides,
  PresenterOverridesContext,
} from "../presenter/PresenterOverridesContext"

export { overridePresenter }
export type { PresenterMockFields, PresenterMockLifecycle }

/**
 * The part of Storybook's React `Decorator` type these decorators use. Storybook accepts it
 * wherever it takes a decorator, so plaza needs no Storybook package.
 */
export type StoryDecorator = (
  Story: ComponentType,
  context: { args: Record<string, unknown> },
) => ReactElement

// Child wins per class over an outer provider; duplicates within one decorator are an authoring
// mistake and throw.
export const mergeOverrides = (
  parent: PresenterOverrides | undefined,
  entries: readonly PresenterOverrideEntry[],
): PresenterOverrides => {
  const classes = entries.map((entry) => entry[0])
  const duplicate = classes.find((cls, i) => classes.indexOf(cls) !== i)
  if (!isUndefined(duplicate))
    throw new Error(`Duplicate presenter override for ${presenterClassName(duplicate)}`)
  return { byClass: new Map([...(parent?.byClass ?? []), ...entries]) }
}

export const withPresenterOverrides = (entries: PresenterOverrideEntry[]): StoryDecorator =>
  function WithPresenterOverrides(Story) {
    const parent = useContext(PresenterOverridesContext)
    // Built once per story mount; usePresenter captures the registry in useState, so changing
    // overrides requires a story remount.
    const [value] = useState(() => mergeOverrides(parent, entries))
    return (
      <PresenterOverridesContext.Provider value={value}>
        <Story />
      </PresenterOverridesContext.Provider>
    )
  }

/**
 * Unlike `withPresenterOverrides`, an arg edited in the Storybook controls panel reaches every
 * mounted mock without remounting the story.
 */
export const withLivePresenterMock = <T extends {}, A extends Record<string, unknown>, Args>(
  PresenterClass: MinimalPresenter<T, A>,
  mapArgs: (args: Args) => PresenterMockFields<NoInfer<T>>,
  lifecycle: PresenterMockLifecycle = {},
): StoryDecorator =>
  function WithLivePresenterMock(Story, context) {
    // Plain ref written during render so factories running during a child's first render see the
    // current args. Storybook types decorator args loosely, so Args is the caller's contract.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const args = context.args as Args
    const argsRef = useRef(args)
    argsRef.current = args

    // Every mock created for this story mount, so args edits reach list items too.
    const [createdMocks] = useState(() => new Set<object>())

    const parent = useContext(PresenterOverridesContext)
    const [value] = useState(() => {
      // Built once per mount so suspense retries reuse the same loading state (see buildLoadingState).
      const loadingState = buildLoadingState(lifecycle.loading)
      const factory = (presenterProps: A) => {
        const mock = buildMockPresenter(
          presenterProps,
          mapArgs(argsRef.current),
          lifecycle,
          loadingState,
        )
        createdMocks.add(mock)
        return mock
      }
      return mergeOverrides(parent, [createPresenterOverrideEntry(PresenterClass, factory)])
    })

    useLayoutEffect(() => {
      // Sync only value fields: a getter became a computed on the mock (extendObservable), and
      // assigning to a computed throws — its value derives through its own dependencies.
      const fields = mapArgs(argsRef.current)
      const valueFields = Object.fromEntries(
        Object.entries(Object.getOwnPropertyDescriptors(fields))
          .filter(([, descriptor]) => !descriptor.get)
          .map(([key, descriptor]) => [key, descriptor.value]),
      )
      runInAction(() => {
        for (const mock of createdMocks) {
          Object.assign(mock, valueFields)
        }
      })
    }, [context.args, createdMocks])

    return (
      <PresenterOverridesContext.Provider value={value}>
        <Story />
      </PresenterOverridesContext.Provider>
    )
  }
