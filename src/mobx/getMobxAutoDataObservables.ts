import { $mobx } from "./mobx-utils"

// Objects that define this symbol as a truthy property will be excluded as auto-observables
export const NotAutoDataObservableSymbol = Symbol("NotAutoDataObservable")

/**
 * Gets a list of all non-function _data_ properties on an object or class instance.
 * These are the "data" keys that could be automatically marked as mobx `observable`.
 *   - functions are excluded because they're potentially `action`
 *   - getters/setters are excluded because they're `computed`/`action`
 *
 * For class instances, the returned keys will account for inheritance (by walking the prototype chain).
 */
export const getMobxAutoDataObservables = <T extends object>(target: T): (string | symbol)[] => {
  const keys: (string | symbol)[] = []

  // Walk the prototype chain
  let current = target
  while (current && current !== Object.prototype) {
    Reflect.ownKeys(current).forEach((key) => {
      if (key === $mobx || key === "constructor") return

      // Exclude all getters and setters. Only data descriptors will contain a `value` key.
      // This must run before the function check below, otherwise getters will be accessed!
      const descriptor = Object.getOwnPropertyDescriptor(current, key)
      if (!descriptor || !("value" in descriptor)) return

      // Exclude functions of any kind. It's safe to index `[key]` here since the `getter` check already
      // happened above.
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
      const val: unknown = (current as any)[key]
      if (val instanceof Function || typeof val === "function") return

      // Exclude anything explicitly marked as not an auto-data-observable
      if (typeof val === "object" && val && Reflect.get(val, NotAutoDataObservableSymbol)) return

      keys.push(key)
    })

    current = Object.getPrototypeOf(current)
  }

  return keys
}
