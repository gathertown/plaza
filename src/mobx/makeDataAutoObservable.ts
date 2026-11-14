import { always } from "ramda"

import { mapReduceKeysIntoObject } from "../helpers"
import { getMobxAutoDataObservables } from "./getMobxAutoDataObservables"
import { type AnnotationsMap, makeObservable, observable, observableRef } from "./mobx-utils"

// The key where we store the annotations cache on class prototypes
const ANNOTATIONS_CACHE_SYMBOL = Symbol("AUTO_DATA_OBSERVABLES")

const withAnnotationsCache = <T>(obj: T) =>
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  obj as T & { [ANNOTATIONS_CACHE_SYMBOL]: AnnotationsMap<T, never> }

/**
 * Symbol that callers attach as a static property on a class to declare which
 * data fields should be annotated as `observableRef` (instead of deep `observable`)
 */
export const MOBX_REF_DATA_KEYS = Symbol("MOBX_REF_DATA_KEYS")

const getMobxRefDataKeys = (obj: object): (string | symbol)[] => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions
  const set = (obj.constructor as any)[MOBX_REF_DATA_KEYS] as Set<string | symbol> | undefined
  return set ? Array.from(set) : []
}

/**
 * Marks all non-function _data_ properties on `obj` as mobx `observable`.
 * See `getMobxAutoDataObservables` for more details on what properties are included.
 *
 * Fields whose name appears in the class's static {@link MOBX_REF_DATA_KEYS}
 * set are annotated as `observableRef` instead of deep `observable`.
 *
 * WARNING: This function will cache the annotations on the prototype chain of `obj` if it's a class instance!
 * This means the object's auto-data-observable properties and `excludes` must be static for the class.
 *
 * @param obj An object or class instance
 * @param excludes An optional array of keys to exclude from being made auto-observable
 * @param includeOnly An optional array of schema field keys that will be the only ones made observable
 */
export const makeDataAutoObservable = <T extends object>(
  obj: T,
  excludes?: Set<string | symbol>,
  includeOnly?: (string | symbol)[],
): T => {
  let annotations: AnnotationsMap<T, never>

  // Pull the annotations cache for the direct class of `obj`, if available.
  // Superclass annotations caches may not be correct.
  if (Object.hasOwn(Object.getPrototypeOf(obj), ANNOTATIONS_CACHE_SYMBOL)) {
    annotations = withAnnotationsCache(obj)[ANNOTATIONS_CACHE_SYMBOL]
  } else {
    // Generate and cache the annotations for this class
    const dataKeys = getMobxAutoDataObservables(obj)
    const refKeys = getMobxRefDataKeys(obj)
    // The ref-key override is a framework-level DEFAULT (fields declared as
    // opaque in the schema get `observableRef` instead of deep `observable`).
    // Explicit caller intent, `excludes` via `@ga.observableClass.exclude(...)`,
    // `includeOnly` via the subclass decorator — must still win.
    const includeOnlySet = includeOnly && new Set<string | symbol>(includeOnly)
    const effectiveRefKeys = refKeys.filter(
      (key) => !excludes?.has(key) && !(includeOnlySet && !includeOnlySet.has(key)),
    )
    if (includeOnly) {
      // `includeOnly` needs a static `schema` whose `shape` lists the class's fields. Plaza doesn't
      // define that schema type, so it reads `shape` untyped.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any,@typescript-eslint/consistent-type-assertions
      const schema = (obj.constructor as any).schema as any
      if (!schema)
        throw new Error("Unexpected: called with `includeOnly` option for a class without schema")
      const keys: (string | symbol)[] = Object.keys(schema.shape ?? {})
      annotations = {
        ...mapReduceKeysIntoObject(dataKeys, always(observable)),
        ...(excludes ? mapReduceKeysIntoObject(Array.from(excludes), () => false) : undefined),
        ...mapReduceKeysIntoObject(keys, () => false),
        // A schema field behind a prototype accessor is not an own data property, and MobX refuses
        // to annotate an accessor as `observable`. Such a field is reactive on its own.
        ...mapReduceKeysIntoObject(
          includeOnly.filter((key) => dataKeys.includes(key)),
          () => observable,
        ),
        // `observableRef` overrides for opaque fields. Filtered above to
        // respect `excludes` and `includeOnly`, so explicit caller intent wins.
        ...mapReduceKeysIntoObject(effectiveRefKeys, always(observableRef)),
      }
    } else {
      annotations = {
        ...mapReduceKeysIntoObject(dataKeys, always(observable)),
        ...(excludes ? mapReduceKeysIntoObject(Array.from(excludes), () => false) : undefined),
        ...mapReduceKeysIntoObject(effectiveRefKeys, always(observableRef)),
      }
    }

    // Cache the annotations on the prototype chain, if this is a class instance
    const proto = Object.getPrototypeOf(obj)
    if (proto && proto !== Object.prototype) {
      Object.defineProperty(proto, ANNOTATIONS_CACHE_SYMBOL, { value: annotations })
    }
  }

  return makeObservable(obj, annotations)
}
