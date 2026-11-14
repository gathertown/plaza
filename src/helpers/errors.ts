export type CustomErrorOptions<M extends Record<string, unknown> | undefined = undefined> = {
  defaultMessage?: string | ((metadata: M) => string)
}

export const createErrorClass = <M extends Record<string, unknown> | undefined = undefined>(
  name: string,
  options: CustomErrorOptions<M> = {},
) => {
  class ErrorTypeClass extends Error {
    metadata: M

    constructor(message?: string, metadata?: M, nativeErrorOptions?: ErrorOptions) {
      super(
        // TODO fix fallback message, maybe unify this constructor logic somehow
        // We need the cast here, TS being unhappy here is somewhat related to the weird casting
        // we're doing with the constructor args
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        message ?? getDefaultMessage(options, metadata as M) ?? `${name} error occurred`,
        nativeErrorOptions,
      )
      this.name = name
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      this.metadata = metadata ?? ({} as M)
      Object.setPrototypeOf(this, new.target.prototype)
    }
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return ErrorTypeClass as unknown as M extends undefined
    ? new (
        message?: string,
        metadata?: undefined,
        nativeErrorOptions?: ErrorOptions,
      ) => InstanceType<typeof ErrorTypeClass>
    : new (
        message: string | undefined,
        metadata: M,
        nativeErrorOptions?: ErrorOptions,
      ) => InstanceType<typeof ErrorTypeClass>
}

export const getDefaultMessage = <M extends Record<string, unknown> | undefined = undefined>(
  options: CustomErrorOptions<M>,
  metadata: M,
): string | undefined => {
  if ("defaultMessage" in options) {
    const { defaultMessage } = options
    return typeof defaultMessage === "function" ? defaultMessage(metadata) : defaultMessage
  }
  return undefined
}

// `instanceof Error` is false for an error from another realm, e.g. a `vm` context or a Node core
// error seen inside Jest.
export const isError = (value: unknown): value is Error =>
  value instanceof Error || Object.prototype.toString.call(value) === "[object Error]"

export const guaranteedError = (error: unknown): Error => {
  if (isError(error)) return error

  // Without an actual Error, we don't have a stacktrace. Get a stacktrace for the bad error
  // by throwing an error locally.
  try {
    // noinspection ExceptionCaughtLocallyJS
    throw new Error("Thrown error was not an instance of Error")
  } catch (e) {
    if (!(e instanceof Error)) return Error("this will never happen")
    console.error(`Caught error not instanceof Error.

  Original error: ${error}

  Stacktrace:\n\n${e.stack}`)
    return e
  }
}

export const suppressError = async <T>(
  fn: () => T | Promise<T>,
  loggerFn?: (e: unknown) => void,
): Promise<T | undefined> => {
  try {
    return await fn()
  } catch (e) {
    loggerFn?.(e)
    return
  }
}

/**
 * Executes a synchronous function and suppresses any errors, optionally logging them.
 * @param fn The synchronous function to execute.
 * @param loggerFn An optional function to log the error if one occurs.
 * @returns The result of the function if successful, otherwise undefined.
 */
export const suppressSyncError = <T>(
  fn: () => T,
  loggerFn?: (e: unknown) => void,
): T | undefined => {
  try {
    return fn()
  } catch (e) {
    loggerFn?.(e)
    return
  }
}
