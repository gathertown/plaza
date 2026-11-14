import { ObservableMap } from "mobx"

import { NotAutoDataObservableSymbol } from "./getMobxAutoDataObservables"

/**
 * Symbol used to expose the underlying `ObservableMap` from proxies created by `observableMapAsRecord`.
 * This allows collection utilities to detect these proxies and use the efficient
 * Map-based observation instead of trying to observe the proxy directly (which doesn't work with MobX).
 */
export const UnderlyingObservableMapSymbol = Symbol("UnderlyingObservableMap")

/**
 * The `ObservableMap` behind a record from `observableMapAsRecord` or `observableMapAsRecordFrom`.
 * Only call it with such a record.
 */
export const underlyingObservableMap = <K extends string, V>(
  record: Readonly<Record<K, V>>,
): ObservableMap<K, V> =>
  // The record type leaves the symbol out, so `Object.values(record)` doesn't infer the map as a
  // value. `mapRecordHandler`'s `get` trap returns the map for it.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  (record as unknown as { [UnderlyingObservableMapSymbol]: ObservableMap<K, V> })[
    UnderlyingObservableMapSymbol
  ]

/**
 * The Proxy target. A `console.log(record)` prints it, which is why it has a descriptive class name
 * and fields. `getMap()` runs on every access so a source can resolve the map lazily.
 */
export interface MapRecordSource<K extends string, V> {
  getMap(): ObservableMap<K, V>
}

class ObservableMapSource<K extends string, V> implements MapRecordSource<K, V> {
  constructor(private readonly map: ObservableMap<K, V>) {}

  getMap() {
    return this.map
  }
}

const throwReadonly = () => {
  throw new Error("Cannot modify readonly property")
}

/**
 * Creates a readonly accessor descriptor that mimics MobX observable object behavior.
 * The getter is called on each access to get the current value.
 *
 * @param getValue Function that returns the current value
 */
export const createReadonlyAccessorDescriptor = <T>(getValue: () => T): PropertyDescriptor => ({
  get: getValue,
  set: throwReadonly,
  enumerable: true,
  configurable: true,
})

/**
 * Shared by every record proxy. It keeps no per-proxy state: everything it needs comes from the
 * target, so each record does not allocate its own handler and closures.
 */
// K and V are erased here: `ObservableMap` is invariant in V through its enhancer, so no single
// concrete source type fits every record. `recordProxy` restores the record type for callers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mapRecordHandler: ProxyHandler<MapRecordSource<any, any>> = {
  get(target, prop) {
    if (prop === NotAutoDataObservableSymbol) return true

    if (prop === UnderlyingObservableMapSymbol) return target.getMap()

    // Jest's `toEqual` treats a Map-like object as a Map; look like a plain object instead.
    if (prop === Symbol.toStringTag) return "Object"
    if (prop === Symbol.iterator) return undefined
    if (prop === "entries" || prop === "values" || prop === "keys" || prop === "forEach")
      return undefined

    if (typeof prop === "string") return target.getMap().get(prop)

    // `$mobx` and other map symbols, for MobX compatibility.
    if (typeof prop === "symbol") return Reflect.get(target.getMap(), prop)

    return undefined
  },

  set: throwReadonly,
  defineProperty: throwReadonly,
  deleteProperty: throwReadonly,
  setPrototypeOf: throwReadonly,
  preventExtensions: throwReadonly,

  has(target, prop) {
    return typeof prop === "string" && target.getMap().has(prop)
  },

  ownKeys(target) {
    return Array.from(target.getMap().keys())
  },

  getOwnPropertyDescriptor(target, prop) {
    if (typeof prop === "string" && target.getMap().has(prop))
      return createReadonlyAccessorDescriptor(() => target.getMap().get(prop))
    return undefined
  },

  // Skip `getMap()` so `instanceof` on a lazy record does not initialize the map.
  getPrototypeOf: () => Object.prototype,

  // A Proxy must report the target's real extensibility or `Object.isExtensible(record)` throws;
  // writes are still refused by the traps above.
  isExtensible: (target) => Reflect.isExtensible(target),
}

const recordProxy = <K extends string, V>(source: MapRecordSource<K, V>): Readonly<Record<K, V>> =>
  // Every trap answers from the map, so the proxy presents as the record and not as its source.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  new Proxy(source, mapRecordHandler) as unknown as Readonly<Record<K, V>>

/**
 * Wraps a MobX `ObservableMap` in a Proxy that provides object-like property access (`obj[key]`)
 * while using `Map` storage underneath.
 *
 * ## Why this exists
 *
 * MobX's `observable({})` has a memory leak when using dynamic keys (like UUIDs). MobX caches
 * property descriptors in a module-level `descriptorCache` that is never garbage collected.
 * `ObservableMap` doesn't have this issue, but uses `.get(key)` syntax instead of `obj[key]`.
 *
 * This utility provides the best of both worlds: `Map` storage (no memory leak) with object-like
 * access (familiar API).
 *
 * ## Features
 *
 * - Object-like property access: `record[key]` instead of `map.get(key)`
 * - Jest-compatible: passes `toEqual` checks against plain objects
 * - MobX-compatible: exposes `$mobx` symbol, works with `isObservable()`
 * - Exposes underlying map via `UnderlyingObservableMapSymbol` for utilities that need direct access
 * - Skips auto-observable via `NotAutoDataObservableSymbol`
 *
 * ## Usage
 *
 * ```typescript
 * const map = observable.map<string, User>()
 * const record = observableMapAsRecord(map)
 *
 * // Object-like access
 * record["user-123"]  // equivalent to map.get("user-123")
 * Object.keys(record) // equivalent to Array.from(map.keys())
 * "user-123" in record // equivalent to map.has("user-123")
 *
 * // Get underlying map when needed
 * const underlyingMap = record[UnderlyingObservableMapSymbol]
 * ```
 *
 * @param map The `ObservableMap` to wrap
 * @returns A proxy that provides object-like access to the map
 */
export const observableMapAsRecord = <K extends string, V>(
  map: ObservableMap<K, V>,
): Readonly<Record<K, V>> => recordProxy(new ObservableMapSource(map))

/**
 * For maps resolved lazily or swapped over time.
 */
export const observableMapAsRecordFrom = <K extends string, V>(
  source: MapRecordSource<K, V>,
): Readonly<Record<K, V>> => recordProxy(source)
