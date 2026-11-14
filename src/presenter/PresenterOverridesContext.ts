import { createContext, useContext } from "react"

import { isUndefined } from "../helpers"
import { isRunningInStorybook } from "./isRunningInStorybook"
import { MinimalPresenter, MinimalPresenterInstance } from "./presenterHelpers"

// Identity-only constructor key. The full generic constructor contract is enforced at the
// entry-builder boundary (overridePresenter); the map itself is heterogeneous.
export type AnyPresenterClass = abstract new (...args: never[]) => object

export type PresenterOverrideFactory = (presenterProps: unknown) => object

// Branded so only createPresenterOverrideEntry can mint an entry — that's where the class-key /
// factory-shape correspondence resolvePresenterOverride relies on is established. A hand-built
// `[SomeClass, () => ({})]` tuple would bypass that and must not typecheck as an entry.
declare const presenterOverrideEntryBrand: unique symbol
export type PresenterOverrideEntry = readonly [AnyPresenterClass, PresenterOverrideFactory] & {
  readonly [presenterOverrideEntryBrand]: true
}

export const createPresenterOverrideEntry = <T extends {}, A extends Record<string, unknown>>(
  PresenterClass: MinimalPresenter<T, A>,
  factory: (presenterProps: A) => MinimalPresenterInstance<T, A>,
): PresenterOverrideEntry =>
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  [PresenterClass, factory] as unknown as PresenterOverrideEntry

// @ga.observableClass renames the class to `${name}ObservableWrapper`; strip that so error messages
// name the presenter as the author wrote it.
export const presenterClassName = (PresenterClass: AnyPresenterClass) =>
  PresenterClass.name.replace(/ObservableWrapper$/, "")

export type PresenterOverrides = {
  byClass: ReadonlyMap<AnyPresenterClass, PresenterOverrideFactory>
}

export const PresenterOverridesContext = createContext<PresenterOverrides | undefined>(undefined)

// Builds the presenter a hook should use: the real class in app builds / when no provider is
// mounted, otherwise the registered override. Under a provider an unlisted class throws — a real
// presenter connects to repos and asyncDeps Storybook never boots, so a missing entry is always a
// forgotten override. The one erased cast lives here: createPresenterOverrideEntry guarantees the
// factory stored under a class key returns an instance shaped for that class.
export const resolvePresenterOverride = <T extends {}, A extends Record<string, unknown>>(
  PresenterClass: MinimalPresenter<T, A>,
  presenterProps: A,
  overrides: PresenterOverrides | undefined,
): MinimalPresenterInstance<T, A> => {
  if (isUndefined(overrides)) return new PresenterClass(presenterProps)

  const factory = overrides.byClass.get(PresenterClass)
  if (isUndefined(factory))
    throw new Error(
      `No presenter override registered for ${presenterClassName(PresenterClass)}. ` +
        `Add one with overridePresenter(...).`,
    )

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return factory(presenterProps) as MinimalPresenterInstance<T, A>
}

export const useOverridesFromContext = () => useContext(PresenterOverridesContext)
const useNoOverrides = () => undefined

// Selected once at module load: Storybook builds read the context; app builds get a constant no-op
// with no context subscription, keeping this off the prod critical path. The selection can never
// change within a running app, so React's hook order stays stable.
export const usePresenterOverrides: () => PresenterOverrides | undefined = isRunningInStorybook()
  ? useOverridesFromContext
  : useNoOverrides
