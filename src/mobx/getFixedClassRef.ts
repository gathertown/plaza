/* eslint-disable @typescript-eslint/consistent-type-assertions */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Class } from "type-fest"

import { just } from "../helpers"
import { isObservableClass } from "./decorators/observableClass"

/**
 * WARNING: Only use this if a lint rule is forcing you to, unless you're very confident in
 * what you're doing!
 *
 * This is a niche helper that exists to grab a decorated class ref from within a static/instance method.
 * In that scenario, references to the class directly by name will usually be stale, so we use this function to
 * climb the prototype chain to find the right decorated class.
 *
 * Example:
 *     @ga.observableClass // this decorator _replaces_ the class when run
 *     class Foo {
 *       static f() {
         return getFixedClassRef(this, Foo) // correct
 *         return Foo // stale
 *       }
 *     }
 *
 * @throws If `MaybeStaleClass` is not in the ancestry chain for `instanceOrClass`
 * @returns The @ga.observableClass class associated with `MaybeStaleClass`
 */
export const getFixedClassRef = <TStale extends Class<any>, TThis extends TStale>(
  instanceOrClass: InstanceType<TThis> | TThis, // need `TThis` here instead of `TStale` so the return value is inferred correctly
  MaybeStaleClass: TStale,
): TStale => {
  // If the class isn't stale, no need to do anything
  if (isObservableClass(MaybeStaleClass)) return MaybeStaleClass

  const isInstance = instanceOrClass instanceof MaybeStaleClass
  const originalConstructor: Class<any> = isInstance
    ? just(
        (instanceOrClass as any).constructor,
        "Expected instance constructor when resolving fixed observable class reference",
      )
    : instanceOrClass

  let current: Class<any> = originalConstructor
  let prevConstructor: Class<any> | undefined

  // Walk the prototype chain until we find MaybeStaleClass
  while (current !== MaybeStaleClass) {
    prevConstructor = current
    current = Object.getPrototypeOf(current)
    if (!current) {
      // Walk far enough up the prototype chain and you'll get `null`...
      throw new Error(
        `The provided input with constructor type ${originalConstructor.name} does not have ancestor class ${MaybeStaleClass.name}!`,
      )
    }
  }

  if (!prevConstructor)
    throw new Error(
      `No subclass found for ${MaybeStaleClass.name} - are you sure this is a ga.observableClass?`,
    )

  // Return the immediate subclass of MaybeStaleClass
  return prevConstructor as TStale
}
