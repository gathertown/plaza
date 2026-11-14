export enum AsyncStatus {
  /* Data hasn't been loaded yet */
  Pending = "Pending",

  /* An error occurred while loading the data */
  Error = "Error",

  /* Data has been successfully loaded */
  Success = "Success",
}

// Define base interface for async state.
export interface StateBase {
  status: AsyncStatus
}

// Define specific interfaces for each state using boolean flags.
export interface StatePending extends StateBase {
  status: AsyncStatus.Pending
  data: undefined
  error: undefined
}

export interface StateSuccess<T> extends StateBase {
  status: AsyncStatus.Success
  data: T
  error: undefined
}

export interface StateError<T = unknown> extends StateBase {
  status: AsyncStatus.Error
  data: T | undefined // Can have data from previous successful load
  error: string
}

// The union type represents all possible states
export type LoadedStateValue<T> = StatePending | StateSuccess<T> | StateError<T>

// For backward compatibility, export the old enum name
export const AsyncLoadStatus = AsyncStatus
