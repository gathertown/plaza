// Exists as a very slightly faster (because it doesn't support currying) impl compared to ramda's.
// Using ours vs. ramda's will almost never matter.
export const isNil = (value: unknown): value is null | undefined =>
  value === null || value === undefined
// Same as `isNil` above.
export const isNotNil = <T>(value: T | null | undefined): value is T =>
  value !== null && value !== undefined

export const isUndefined = (value: unknown): value is undefined => value === undefined

export const isObject = (val: unknown): val is object => val !== null && typeof val === "object"

/**
 * Creates a Record by transforming an array of keys into key-value pairs.
 *
 * Rejected names (in case people search for them):
 *   - mapKeysIntoObject
 *   - mapReduceListToObject
 *   - mapListIntoObjectWithKeys
 *
 * @param keys Array of keys to use
 * @param transform Function that takes a key and returns its corresponding value
 */
export const mapReduceKeysIntoObject = <K extends string | symbol, V>(
  keys: readonly K[],
  transform: (key: K) => V,
): Record<K, V> =>
  keys.reduce<Record<K, V>>(
    (acc, key) => {
      acc[key] = transform(key)
      return acc
    },
    // Can't do this without a cast.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    {} as Record<K, V>,
  )

export const assertNotNil: <T>(x?: T | null, message?: string) => asserts x is NonNullable<T> = (
  x,
  message = "value is nullish",
) => {
  if (x !== null && x !== undefined) return

  const error = new Error(message)
  const internalJestCallThatIndicatesDeepComparison = "deepCyclicCopyObject"
  const internalModelGetterThatIndicatesRelationGetter = "GatherObservableClassWrapper.get"
  if (
    // Jest's deep comparison calls getters on observable classes, which can throw here.
    process.env.NODE_ENV === "test" &&
    error.stack?.includes(internalJestCallThatIndicatesDeepComparison) &&
    error.stack?.includes(internalModelGetterThatIndicatesRelationGetter)
  ) {
    console.error(
      `
⚠️ ⚠️ ⚠️ ⚠️ ⚠️
You hit a subtle edge case in Jest!

TL;DR: you have a model in a toEqual/toBe assertion and a getter is throwing. Either:
  - avoid putting your entire model in a toEqual/toBe assertion, or
  - ensure all getters do not throw when evaluated; you can use the stack trace to locate them

See notes in the stack trace on \`assertNotNil\` for more detail.
⚠️ ⚠️ ⚠️ ⚠️ ⚠️
`,
      // If your stack trace from a unit test brought you here on a `.toEqual` or `.toBe`
      // assertion that includes a model, e.g. `expect(model1).toEqual(model2)`, read on.
      //
      // Basically, Jest does a deep comparison (even with `toBe`), and it will exercise all the
      // relationship getters. If there are any relationships missing that are assumed to be
      // present, you will get an error.
      //
      // For reasons that we don't understand, throwing inside the `toEqual` swallows the stack
      // trace in a mysterious way, so we have to log the error here explicitly.
      //
      // We need to recreate the error here, so we have the stack trace point to the right spot.
      new Error(error.message),
    )
  }
  throw error
}

/**
 * Checks if it's "just" the value and turns a maybe type into a definite type. Naming convention
 * borrowed from FP concept of Maybe/Just:
 * https://engineering.dollarshaveclub.com/typescript-maybe-type-and-module-627506ecc5c8
 *
 * Pass a descriptive `message` in production code, so a thrown error says what was expected and is
 * easy to find in your error tracker. It stays optional because in tests a message is noise.
 */
export const just = <T>(
  x?: T | null,
  message = "Expected something, got nothing",
): NonNullable<T> => {
  assertNotNil(x, message)
  return x
}
