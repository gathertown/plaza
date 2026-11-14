import { guaranteedError, isNil, tryCatchAsync, VoidFunction } from "../helpers"
import { Destructible, ga } from "../mobx"
import { AsyncStatus, LoadedStateValue, StateBase } from "./asyncStateShared"

// ---------------------------------------------------------------------------
// AsyncState
// ---------------------------------------------------------------------------

/** Settled by the load being retired rather than by its request answering. */
const RETIRED = Symbol("AsyncState load retired")

/**
 * The one load an `AsyncState` is waiting on.
 *
 * Retiring a load is replacing it, so identity is the generation: a load asks whether it is still
 * the held one instead of matching a counter, and `outcome` answers that question and the request's
 * in a single value. The request itself keeps running — nothing here can stop it — but `race` stays
 * subscribed to it, so an answer that arrives after the retirement is discarded rather than
 * unhandled.
 */
class AsyncLoad<TData> {
  private _retire: VoidFunction = () => undefined
  private readonly _retired: Promise<typeof RETIRED> = new Promise((resolve) => {
    this._retire = () => resolve(RETIRED)
  })
  private _request: Promise<TData> | undefined = undefined

  /**
   * Hands over the request to wait on. Separate from construction so the load is already the held
   * one while `loadFn` runs, which is what lets a `reset` from inside it retire this load rather
   * than the one it replaced.
   */
  track(request: Promise<TData>): void {
    this._request = request
    // Subscribed here rather than at the first `outcome` read, because there may never be one: an
    // `onLoad` handler that throws leaves through the caller's catch, and the request would then be
    // running with nothing attached to it at all. Reading `outcome` later still sees the rejection;
    // handlers do not compete for it.
    request.catch(() => undefined)
  }

  /**
   * The request's answer, or `RETIRED` if the load stopped being the current one first. Resolves
   * `RETIRED` immediately for a load retired before it had a request, which is where a `loadFn`
   * that throws before returning one leaves it.
   */
  get outcome(): Promise<TData | typeof RETIRED> {
    if (isNil(this._request)) return this._retired

    return Promise.race([this._request, this._retired])
  }

  retire(): void {
    this._retire()
  }
}

type AsyncStateReadonly<TData, TParams = void> = Pick<
  AsyncState<TData, TParams>,
  | "status"
  | "data"
  | "dataOrThrow"
  | "error"
  | "isError"
  | "isFetching"
  | "isRefetching"
  | "isFetchingWithoutData"
  | "isErrorWithoutData"
  | "hasData"
  | "awaitLoad"
  | "ensureLoaded"
>

export interface AsyncStateOptions<TData, TParams = void> {
  /** Optional label for identifying this AsyncState instance in telemetry and error logs. */
  label?: string
  onLoad?: (params: TParams) => void
  onSuccess?: (data: TData, params: TParams) => void
  onError?: (error: string, params: TParams) => void
  onSettled?: (params: TParams) => void
}

/** Anything an `AsyncState` belongs to. It stops loading once `isDestroyed` turns true. */
export type AsyncStateOwner = Pick<Destructible, "isDestroyed">

// Axios rejects a canceled request with a `CanceledError`. A fetch `AbortError` stays a failure,
// because Gather aborts requests that time out.
const isCanceledRequest = (error: unknown): boolean =>
  error instanceof Error && error.name === "CanceledError"

// Not observable: _options holds immutable constructor callbacks (onLoad/onSuccess/onError/onSettled),
// assigned once and never reassigned—same rationale as the load bookkeeping. MobX overhead on every
// read across many instances and transitions buys nothing.
/**
 * `load` can resolve before its request settles, because a canceled load resolves right away. A
 * rejection sets the state to an error. A canceled load sets it to neither success nor error and
 * runs neither `onSuccess` nor `onError`. An aborted request cancels a load. A later `load` cancels
 * it too, as does `reset`, `seed` or `destroy`. To undo optimistic work, read `isSuccess`,
 * `isError` and `wasCanceled` after `load` resolves.
 *
 * A state starts no load once it, or the object passed as its first argument, is destroyed. A
 * response that arrives after that is dropped without running `onSuccess` or `onError`. Loading
 * resumes if that object's `isDestroyed` turns false again, as it does for a presenter under
 * StrictMode.
 */
@ga.observableClass.exclude(["_currentLoad", "_options", "_owner"])
export class AsyncState<TData, TParams = void> extends Destructible implements StateBase {
  /** For a state that lasts as long as the page, which nothing ever destroys. */
  static readonly neverDestroyed: AsyncStateOwner = { isDestroyed: false }

  private _state: LoadedStateValue<TData> = {
    status: AsyncStatus.Pending,
    data: undefined,
    error: undefined,
  }
  private _isFetching: boolean = false
  /** The load whose answer speaks for this state. Everything else is already retired. */
  private _currentLoad: AsyncLoad<TData> | undefined = undefined
  private _options: AsyncStateOptions<TData, TParams>
  private readonly _owner: AsyncStateOwner

  constructor(
    owner: AsyncStateOwner,
    private loadFn: TParams extends void
      ? () => Promise<TData>
      : (params: TParams) => Promise<TData>,
    options: AsyncStateOptions<TData, TParams> = {},
  ) {
    super()
    this._owner = owner
    this._options = options
  }

  get readonly(): AsyncStateReadonly<TData, TParams> {
    return this
  }

  // Expose current state properties
  get status(): AsyncStatus {
    return this._state.status
  }

  get data(): TData | undefined {
    return this._state.data
  }

  get error(): string | undefined {
    return this._state.error
  }

  // Type guard methods to narrow the type
  isFetching(): boolean {
    return this._isFetching
  }

  isRefetching(): this is AsyncState<TData, TParams> & { data: TData } {
    return this._isFetching && this._state.data !== undefined
  }

  isFetchingWithoutData(): boolean {
    return this._isFetching && this._state.data === undefined
  }

  isErrorWithoutData(): boolean {
    return this._state.status === AsyncStatus.Error && this._state.data === undefined
  }

  hasData(): this is AsyncState<TData, TParams> & { data: TData } {
    return this._state.data !== undefined
  }

  // Type guard methods for type narrowing
  isPending(): this is AsyncState<TData, TParams> & {
    status: AsyncStatus.Pending
    data: undefined
  } {
    return this._state.status === AsyncStatus.Pending
  }

  isSuccess(): this is AsyncState<TData, TParams> & { status: AsyncStatus.Success; data: TData } {
    return this._state.status === AsyncStatus.Success
  }

  isError(): this is AsyncState<TData, TParams> & { status: AsyncStatus.Error; error: string } {
    return this._state.status === AsyncStatus.Error
  }

  /**
   * The load settled without an answer of its own, which is where a cancellation leaves the state.
   * Read it once a `load` has resolved, where success and error are the only other outcomes — a
   * state that has not loaded yet is pending too.
   */
  wasCanceled(): boolean {
    return this.isPending()
  }

  @ga.action
  reset() {
    this._state = { data: undefined, error: undefined, status: AsyncStatus.Pending }
    this._isFetching = false
    this._retireCurrentLoad()
  }

  /**
   * Cancels the running load and refuses every later one without calling `loadFn`. Use it on a
   * state that is dropped before the object passed as its first argument is destroyed.
   */
  override destroy() {
    this.reset()
    super.destroy()
  }

  private get isLive(): boolean {
    return !this.isDestroyed && !this._owner.isDestroyed
  }

  private isApplying(load: AsyncLoad<TData>): boolean {
    return this._currentLoad === load && this.isLive
  }

  load(params: TParams): Promise<TData | undefined>
  load(...args: TParams extends void ? [] : never): Promise<TData | undefined>
  load(params?: TParams): Promise<TData | undefined> {
    // Function overloads protect us here, but we need to cast to get the right type to _loadImpl.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return this._loadImpl(params as TParams)
  }

  private _loadImpl = async (params: TParams) => {
    if (!this.isLive) return undefined

    // The request already running doesn't stop, but its answer no longer speaks for this state.
    const load = this._beginLoad()

    this.setFetchingStarted()

    try {
      // Inside the try, so a `loadFn` that throws before it returns a promise clears the fetching
      // flag through the error path below instead of leaving the state fetching with nothing to
      // wait on. Before onLoad, so a handler that reaches back into `ensureLoaded` or `awaitLoad`
      // finds the load it is being told about.
      load.track(this.loadFn(params))

      // Call onLoad handler.
      if (this._options.onLoad) {
        this._options.onLoad(params)
      }

      // A `seed` or `reset` mid-flight settles this as retired, so the caller is released now
      // rather than held for an answer that can no longer be applied. The identity check is not
      // redundant with that: `race` settles on whichever came first, so a request that answered
      // before the retirement still wins it, and a retirement between the race settling and this
      // line is not in the outcome at all.
      const outcome = await load.outcome
      if (outcome === RETIRED || !this.isApplying(load)) return undefined

      const data = outcome

      this.setFetchingSuccess(data)
      // Call onSuccess handler.
      if (this._options.onSuccess) {
        this._options.onSuccess(data, params)
      }
      // Call onSettled handler.
      if (this._options.onSettled) {
        this._options.onSettled(params)
      }
      return data
    } catch (error: unknown) {
      if (!this.isApplying(load)) return undefined
      if (isCanceledRequest(error)) return undefined

      // TODO This could accept some error handling function to parse the error correctly?
      const errorMessage = guaranteedError(error).message
      this.setFetchingError(errorMessage)

      // Call onError handler.
      if (this._options.onError) {
        this._options.onError(errorMessage, params)
      }
      // Call onSettled handler.
      if (this._options.onSettled) {
        this._options.onSettled(params)
      }

      // TODO This maybe doesn't need to live here forever, but we need it for now
      //      because the loading error above doesn't show up in UI, and will probably overall be
      //      helpful for debugging purposes.
      console.error(
        "AsyncState load failed",
        error,
        this._options.label ? { asyncStateLabel: this._options.label } : {},
      )
      return undefined
    }
  }

  async awaitLoad() {
    // Follow the load the state holds now rather than the one it held on entry. Waiting on a single
    // request would park a joiner past a `seed` that already gave the state its data, and returning
    // on any retirement would release it the moment a replacement load took over — while the state
    // is still fetching and may still have no data. `seed` and `reset` clear the fetching flag as
    // they retire, so those release immediately; a replacement load does not, so the joiner follows
    // it to its answer.
    while (this.isFetching()) {
      const load = this._currentLoad
      if (isNil(load)) return

      await load.outcome
    }
  }

  ensureLoaded(params: TParams): Promise<void>
  ensureLoaded(...args: TParams extends void ? [] : never): Promise<void>
  ensureLoaded(params?: TParams): Promise<void> {
    // Function overloads protect us here, but we need to cast to get the right type to _ensureLoadedImpl.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return this._ensureLoadedImpl(params as TParams)
  }

  private async _ensureLoadedImpl(params: TParams) {
    if (this.isSuccess()) return

    // Read before the first await so callers arriving in one tick share the load rather than racing
    // to start it, where the second `load` would cancel the first. A joiner only observes: retrying
    // from here would let N joiners start N loads that cancel each other. A caller that arrives
    // after the failure is recorded starts the retry.
    if (this.isFetching()) {
      await tryCatchAsync({ try: () => this.awaitLoad(), catch: () => undefined })
      return
    }

    await this._loadImpl(params)
  }

  get dataOrThrow(): TData {
    if (this._state.data === undefined)
      throw new Error(`Data is not loaded (Status: ${this._state.status})`)

    return this._state.data
  }

  /**
   * Marks the state loaded with data another request fetched. `ensureLoaded` then skips the round
   * trip, and `load` still refetches.
   */
  @ga.action
  seed(data: TData) {
    // An in-flight load that settles after this would overwrite the seeded data, so it is dropped
    // the same way `reset` drops it.
    this._retireCurrentLoad()

    this._state = { data, error: undefined, status: AsyncStatus.Success }
    this._isFetching = false
  }

  /** Drops whatever load is running. Its request keeps going; its answer is discarded. */
  private _retireCurrentLoad(): void {
    this._currentLoad?.retire()
    this._currentLoad = undefined
  }

  /** Retires whatever load is running and holds a fresh one, which the caller owns. */
  private _beginLoad(): AsyncLoad<TData> {
    this._retireCurrentLoad()
    this._currentLoad = new AsyncLoad()
    return this._currentLoad
  }

  @ga.action
  private setFetchingStarted() {
    this._isFetching = true
    // Don't change status or clear data - keep existing data during refetch
  }

  @ga.action
  private setFetchingError(errorMessage: string) {
    this._state = {
      data: this._state.data, // Keep existing data on error
      error: errorMessage,
      status: AsyncStatus.Error,
    }
    this._isFetching = false
  }

  @ga.action
  private setFetchingSuccess(data: TData) {
    this._state = { data, error: undefined, status: AsyncStatus.Success }
    this._isFetching = false
  }
}
