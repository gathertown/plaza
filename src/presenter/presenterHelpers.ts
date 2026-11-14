import { AsyncState } from "./AsyncState"

/**
 * Defines the most minimal configuration of a presenter, usually used for extending or generic
 * typing.
 */
export type MinimalPresenter<T extends {}, A extends Record<string, unknown>> = new (
  presenterProps: A,
) => T & {
  syncProps: (presenterProps: A) => void
  reloadOnPropChange: () => Promise<unknown> | void
  destroy: () => void
  asyncDepsLoaded: boolean
  afterMount(): void | Promise<void>
  afterMountBase(): void | Promise<void>
  afterMountOrPropChange(): void | Promise<void>
  afterMountOrPropChangeBase(): void | Promise<void>
  destroyAfterMountOrOnPropChangeDestructors(): void
}

export type MinimalPresenterInstance<
  T extends {},
  A extends Record<string, unknown>,
> = InstanceType<MinimalPresenter<T, A>>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAsyncState = AsyncState<any, any>

export type AsyncStateDeps = Record<string, AnyAsyncState>

/**
 * Transforms a record of AsyncState dependencies into a record of their loaded data.
 * This allows presenters to access `this.asyncDeps.someQuery` instead of
 * `this.rawAsyncDeps.someQuery.dataOrThrow`, providing a cleaner API for accessing loaded
 * dependency data.
 */
export type AsyncStateDataFromDeps<D extends AsyncStateDeps> = {
  [K in keyof D]: D[K]["dataOrThrow"]
}
