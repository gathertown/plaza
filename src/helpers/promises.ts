import { guaranteedError } from "./errors"

/**
 * Marks a promise as deliberately not awaited, so a reader knows the missing `await` isn't a bug.
 *
 * @example
 * // Background a promise directly
 * fireAndForget(analyticsService.track('user_action'))
 *
 * // Background a function call
 * fireAndForget(() => expensiveBackgroundWork())
 *
 * // Name the failure in the default log line
 * fireAndForget(riskyCacheUpdate(), 'Cache update failed')
 *
 * // With custom error handling, which replaces the default log line
 * fireAndForget(riskyCacheUpdate(), undefined, (error) => console.warn('Cache update failed', error))
 */
export const fireAndForget = <T>(
  promise: Promise<T> | (() => Promise<T>),
  errorMessage?: string,
  onError?: (error: unknown) => void,
): void => {
  const actualPromise = typeof promise === "function" ? promise() : promise

  actualPromise.catch((error) => {
    if (onError) {
      onError(error)
    } else {
      // Default error handling - log but don't throw
      console.error(
        `[Fire-and-forget promise rejected]${errorMessage ? ` ${errorMessage}:` : ""} ${guaranteedError(error).message}`,
        error,
      )
    }
  })
}

export type DeferredPromise<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: Error) => void
}

/**
 * sets up a promise and its callbacks, so you can do whatever with them
 */
export function deferredPromise(): DeferredPromise<void>
export function deferredPromise<T>(): DeferredPromise<T>
// eslint-disable-next-line func-style -- TS overloads need a function declaration
export function deferredPromise<T>(): {
  promise: Promise<T>
  resolve: (_: T) => void
  reject: (_reason?: Error | undefined) => void
} {
  let resolve = (_: T) => {}
  let reject = (_reason?: Error) => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export async function tryCatchAsync<T>(args: {
  try: () => Promise<T>
  catch: (e: unknown) => never | Promise<never>
}): Promise<T>
export async function tryCatchAsync<T, C>(args: {
  try: () => Promise<T>
  catch: (e: unknown) => C | Promise<C>
}): Promise<T | C>
// eslint-disable-next-line func-style -- TS overloads need a function declaration
export async function tryCatchAsync<T, C>({
  try: tryFn,
  catch: catchFn,
}: {
  try: () => Promise<T>
  catch: (e: unknown) => never | C | Promise<never | C>
}): Promise<T | C> {
  try {
    return await tryFn()
  } catch (e) {
    return await catchFn(e)
  }
}
