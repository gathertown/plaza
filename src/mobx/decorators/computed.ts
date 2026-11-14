import {
  computed,
  extendObservable,
  IComputedValue,
  isComputedProp as isComputedPropMobX,
  isObservableObject,
} from "mobx"

import { isTestNodeEnv } from "../nodeEnv"
import { computedOverrideCheck } from "./computedOverrideCheck"
import { getOrCreateObsClassInternalData } from "./internals"

// MobX `computed`, but with `keepAlive` enabled: https://mobx.js.org/computeds.html#keepalive
export const keepAliveComputed = computed({ keepAlive: true })
export type KeepAliveComputed = typeof keepAliveComputed

/**
 * Set on an instance by the `@ga.observableClass` destructor once its computeds are destroyed. A
 * getter read after that evaluates plainly: defining a keepAlive computed then would leave one that
 * nothing destroys, subscribed to its dependencies and pinning the dead instance.
 */
export const ComputedsDestroyedSymbol = Symbol("ComputedsDestroyed")

type MaybeDestroyed = { readonly [ComputedsDestroyedSymbol]?: true }

export const resolveDescriptor = (
  prototype: object | null,
  key: PropertyKey,
): PropertyDescriptor | undefined => {
  for (let current = prototype; current; current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key)
    if (descriptor) return descriptor
  }
  return undefined
}

/**
 * Prototype getter that defines the keepAlive computed on the instance the first time it is read.
 * An unread getter would otherwise allocate a `ComputedValue` and an own accessor.
 * MobX only sees the computed once it exists: introspect through the `mobx-utils` facade.
 *
 * MobX does the same for its own `@computed` decorator since mobxjs/mobx#4639 (the `ComputedValue`
 * is created on the first read, tracked in the administration's `lazyComputedKeys_`), but only on
 * the decorator path. The annotation-map path that `makeObservable(this, { key: computed })` takes
 * stays eager, so this getter fills the gap and defines the computed through `extendObservable`,
 * MobX's documented way to add one after construction.
 */
const createLazyComputedGetter = <This extends object, TValue>(
  originalGetter: (this: This) => TValue,
  context: ClassGetterDecoratorContext<This, TValue>,
  annotation: KeepAliveComputed,
): ((this: This) => TValue) => {
  const key = context.name

  context.addInitializer(function () {
    // Recorded on the leaf prototype for the destructor in `@ga.observableClass`.
    const internals = getOrCreateObsClassInternalData(this)
    internals.computeds ??= new Set()
    internals.computeds.add(key)
  })

  const lazyGetter = function (this: This): TValue {
    // Plain evaluation when there is no MobX administration (immutable models, construction,
    // classes without `@ga.observableClass`), computeds were destroyed, `super.` reached an already
    // computed key, or an own property is already in place. That last one is a test spy or a manual
    // define: replacing it with MobX's non-configurable accessor would break jest's restore.
    if (
      !isObservableObject(this) ||
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      (this as MaybeDestroyed)[ComputedsDestroyedSymbol] ||
      isComputedPropMobX(this, key) ||
      Object.hasOwn(this, key)
    ) {
      return originalGetter.call(this)
    }
    // Resolved on every cold read rather than cached per prototype: a prototype-level spy replaces
    // the descriptor and has to win for instances that materialize afterwards.
    const resolved = resolveDescriptor(Object.getPrototypeOf(this), key)
    // Reached through `super.` from a decorated override, which materializes its own computed.
    if (resolved?.get !== lazyGetter) return originalGetter.call(this)

    const properties: Record<PropertyKey, unknown> = {}
    Object.defineProperty(properties, key, {
      get: originalGetter,
      set: resolved.set,
      enumerable: true,
      configurable: true,
    })
    extendObservable(this, properties, { [key]: annotation })
    // An interceptor can cancel the addition; `this[key]` would then be this getter again.
    return Object.hasOwn(this, key)
      ? // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        ((this as Record<PropertyKey, unknown>)[key] as TValue)
      : originalGetter.call(this)
  }
  computedOverrideCheck.register(lazyGetter)
  return lazyGetter
}

/**
 * Destroys a computed value created with `keepAlive: true`.
 * This is only applicable for `keepAlive` computeds - regular computeds do not need to
 * be destroyed (this function will no-op).
 *
 * MobX has no public way to turn `keepAlive` off, so this flips `keepAlive_` and calls `suspend_`.
 * Keeping each computed alive with a reaction instead recomputes all of them on every write to a
 * shared dependency, 200 times slower than this in a 20k-computed benchmark.
 */
export const destroyComputed = (computed: IComputedValue<unknown>) => {
  if (!("keepAlive_" in computed))
    throw new Error("`destroyComputed` received computed without `keepAlive_` property")
  computed.keepAlive_ = false
  if (!("suspend_" in computed) || typeof computed.suspend_ !== "function")
    throw new Error("`destroyComputed` received computed without `suspend_` property")
  computed.suspend_()
}

/**
 * This is the underlying implementation of `@ga.computed`.
 * DO NOT use this directly - import via `ga` instead.
 *
 * Relies on `@ga.observableClass`. The getter stays a plain getter otherwise. See
 * `createLazyComputedGetter` for first-read materialization.
 */
export const __computed = <This extends object, TValue>(
  originalGetter: (this: This) => TValue,
  context: ClassGetterDecoratorContext<This, TValue>,
): ((this: This) => TValue) => createLazyComputedGetter(originalGetter, context, keepAliveComputed)

/**
 * This is the underlying implementation of `@ga.computed.equals()`.
 * DO NOT use this directly - import via `ga` instead.
 *
 * Same as `__computed`, with a custom equality function deciding whether the computed value changed.
 */
export const __computedEquals = <TValue>(comparer: (a: TValue, b: TValue) => boolean) => {
  const equalsComputed = computed({ keepAlive: true, equals: comparer })
  // `TValue` is inferred from the comparer, and constraining the getter's value type to it makes TS
  // check the getter's return type against the comparer at the decoration site, so the comparer
  // gets real argument types instead of `unknown`. The returned getter keeps the getter's own type,
  // which the decorator contract requires (a comparer over `unknown` must not widen the getter).
  return function <This extends object, TGetterValue extends TValue>(
    originalGetter: (this: This) => TGetterValue,
    context: ClassGetterDecoratorContext<This, TGetterValue>,
  ): (this: This) => TGetterValue {
    return createLazyComputedGetter(originalGetter, context, equalsComputed)
  }
}

/**
 * This opts out of making a computed getter in a test env, making it possible to spy on. If it's
 * computed, the field is not configurable and can't be spied upon.
 *
 * Outside unit tests, this has the same behavior as `@ga.computed`.
 */
export const __computedExceptInTestsToBeSpyable = <This extends object, TValue>(
  originalGetter: (this: This) => TValue,
  context: ClassGetterDecoratorContext<This, TValue>,
): ((this: This) => TValue) | undefined => {
  if (isTestNodeEnv()) return undefined

  return __computed(originalGetter, context)
}
