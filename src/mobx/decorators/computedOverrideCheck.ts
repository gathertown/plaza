import { Class } from "type-fest"

import { isProductionNodeEnv } from "../nodeEnv"

/**
 * Only a decorated getter defines its computed, so an undecorated override of a `@ga.computed`
 * getter stays a plain getter: recomputed on every read, and invisible to anything observing the
 * key through the facade. Types cannot see the decorator, and declaration files drop it, so a
 * decorated parent in another module is invisible to lint.
 */
interface ComputedOverrideCheck {
  register(getter: object): void
  /**
   * Walked at class decoration, before a test can replace a descriptor with a spy.
   */
  assertOverridesAreDecorated(OriginalClass: Class<unknown>): void
}

class DecorationTimeComputedOverrideCheck implements ComputedOverrideCheck {
  private readonly lazyGetters = new WeakSet<object>()

  register(getter: object) {
    this.lazyGetters.add(getter)
  }

  assertOverridesAreDecorated(OriginalClass: Class<unknown>) {
    const plainGetterOwners = new Map<PropertyKey, string>()
    const seen = new Set<PropertyKey>()
    for (
      let prototype: object | null = OriginalClass.prototype;
      prototype && prototype !== Object.prototype;
      prototype = Object.getPrototypeOf(prototype)
    ) {
      for (const key of Reflect.ownKeys(prototype)) {
        const getter = Object.getOwnPropertyDescriptor(prototype, key)?.get
        if (!getter) {
          continue
        }
        if (!seen.has(key)) {
          seen.add(key)
          if (!this.isLazyGetter(getter)) {
            plainGetterOwners.set(key, prototype.constructor.name)
          }
          continue
        }
        const plainOwner = plainGetterOwners.get(key)
        if (plainOwner && this.isLazyGetter(getter)) {
          throw new Error(
            `"${plainOwner}.${String(key)}" overrides the @ga.computed getter ` +
              `"${prototype.constructor.name}.${String(key)}" without @ga.computed. ` +
              "Decorate the override too, otherwise it is no longer computed.",
          )
        }
      }
    }
  }

  private isLazyGetter(getter: unknown): boolean {
    return typeof getter === "function" && this.lazyGetters.has(getter)
  }
}

class DisabledComputedOverrideCheck implements ComputedOverrideCheck {
  register() {}

  assertOverridesAreDecorated() {}
}

export const computedOverrideCheck: ComputedOverrideCheck = isProductionNodeEnv()
  ? new DisabledComputedOverrideCheck()
  : new DecorationTimeComputedOverrideCheck()
