import { Class } from "type-fest"

import { VoidFunction } from "../../helpers"
import { getMobxAdmin } from "../getMobxAdmin"
import { makeDataAutoObservable } from "../makeDataAutoObservable"
import { makeObservable } from "../mobx-utils"
import { isProductionNodeEnv } from "../nodeEnv"
import { ComputedsDestroyedSymbol, destroyComputed } from "./computed"
import { computedOverrideCheck } from "./computedOverrideCheck"
import { getOrCreateObsClassInternalData, ObservableClassInternalSymbol } from "./internals"

type ObservableClass = Class<{
  addDestructor(f: VoidFunction): void
  afterObservable?(): void
  immutable?: boolean
}>

// All classes created with this decorator will be marked with this symbol
const ObservableClassSymbol = Symbol("ObservableClass")

export const isObservableClass = (C: Class<unknown>) =>
  Object.hasOwn(C, ObservableClassSymbol) &&
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  (C as { [ObservableClassSymbol]?: true })[ObservableClassSymbol] === true

export const getEnforceSubclassesFlag = (C: Class<unknown>): boolean =>
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  (C as { [EnforceObservableSubclassesSymbol]?: boolean })[EnforceObservableSubclassesSymbol] ??
  false

/**
 * A field to store excludes on the prototype chain.
 * This data can't be on the usual `ObservableClassInternalSymbol` because it needs to be shared
 * across all classes in the prototype chain. For example - a subclass should be able to *append*
 * to the excludes list of its superclass without *overwriting* it.
 */
export const ObservableClassExcludesSymbol = Symbol("ObservableClassExcludes")

export const EnforceObservableSubclassesSymbol = Symbol("EnforceObservableSubclasses")

/**
 * Internal impl for the `@ga.observableClass` decorators.
 *
 * @param OriginalClass The class to extend
 * @param excludes The keys to exclude from being made observable, if any
 * @returns A new class that extends the original class, satisfying `@ga.observableClass` functionality.
 */
const createObservableClass = <TClass extends ObservableClass>(
  OriginalClass: TClass,
  excludes?: (string | symbol)[],
  includeOnly?: (string | symbol)[],
) => {
  computedOverrideCheck.assertOverridesAreDecorated(OriginalClass)

  class GatherObservableClassWrapper extends OriginalClass {
    static [ObservableClassSymbol] = true

    static [EnforceObservableSubclassesSymbol] = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args)

      // Update the excludes list on the prototype chain, wherever it is.
      // See `ObservableClassExcludesSymbol` for more.
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const thisWithExcludes = this as {
        readonly [ObservableClassExcludesSymbol]?: Set<string | symbol>
      }
      if (excludes) {
        if (!thisWithExcludes[ObservableClassExcludesSymbol]) {
          // If no exclude cache exists anywhere yet, create one on this class prototype
          Object.getPrototypeOf(this)[ObservableClassExcludesSymbol] = new Set<string | symbol>()
        } else if (!Object.getPrototypeOf(this).hasOwnProperty(ObservableClassExcludesSymbol)) {
          // If the existing exclude cache is from a superclass, clone it for this class
          Object.getPrototypeOf(this)[ObservableClassExcludesSymbol] = new Set(
            thisWithExcludes[ObservableClassExcludesSymbol],
          )
        }
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const excludesCache = thisWithExcludes[ObservableClassExcludesSymbol]!
        excludes.forEach((key) => excludesCache.add(key))
      }

      const enforceSubclasses = getEnforceSubclassesFlag(GatherObservableClassWrapper)

      const leafConstructor: Class<unknown> = new.target

      if (enforceSubclasses && !isObservableClass(leafConstructor) && !isProductionNodeEnv()) {
        const parentName = OriginalClass.name
        const childName = leafConstructor.name
        throw new Error(
          `Class "${childName}" extends observable class "${parentName}" but is not itself observable. ` +
            `You must decorate "${childName}" with @ga.observableClass. \n\n` +
            `${getEnforcementChain(this)}`,
        )
      }

      // If `TClass` is not the leaf class for `this` (i.e. we're currently "in a superclass"), don't do anything else yet.
      // Superclass constructors run before subclass decorators have a chance to run their initializers,
      // so the view of annotations right now is incomplete. MobX doesn't allow re-annotating the same properties, so we
      // need to do it exactly once.
      if (Object.getPrototypeOf(this) !== GatherObservableClassWrapper.prototype) return

      if (!this.immutable) {
        // Make all data fields on this class observable
        // Only one `includeOnly` along the prototype chain is supported.
        makeDataAutoObservable(this, thisWithExcludes[ObservableClassExcludesSymbol], includeOnly)

        // Apply annotations from decorators like `@ga.action`, etc
        const internals = getOrCreateObsClassInternalData(this)
        makeObservable(this, internals.annotations)

        // Setup destructor for computeds, if necessary
        const { computeds } = internals
        if (computeds) {
          this.addDestructor(() => {
            // Mark the instance before tearing down. If `destroyComputed` throws, the instance still
            // counts as destroyed, and a later read cannot define a keepAlive computed that nothing
            // would destroy.
            Object.defineProperty(this, ComputedsDestroyedSymbol, { value: true })
            const values = getMobxAdmin(this).values_
            computeds.forEach((name) => {
              // If there's no `value`, then `@ga.computed` has not defined it yet and it doesn't need to
              // be destroyed.
              const value = values.get(name)
              if (value) {
                destroyComputed(value)
              }
            })
          })
        }
      }

      this.afterObservable?.()
    }
  }

  // Rename this class for easier debugging
  Object.defineProperty(GatherObservableClassWrapper, "name", {
    value: `${OriginalClass.name}ObservableWrapper`,
  })

  return GatherObservableClassWrapper
}

// Default keys to always exclude from being made observable.
export const DEFAULT_EXCLUDES = [
  // We know internally that all `@ga.observableClass` will have these symbols, but we don't want to type them publicly,
  // so we cast it here to avoid TS errors when using it.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  ObservableClassInternalSymbol as symbol,
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  ObservableClassExcludesSymbol as symbol,
]

const getEnforcementChain = (current: object): string => {
  let proto = Object.getPrototypeOf(current)
  let depth = 0
  const lines: string[] = ["🧩 Observable enforcement trace:"]

  while (proto && proto.constructor !== Object) {
    const ctor = proto.constructor
    const name = ctor.name
    const isObservable = isObservableClass(ctor)
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
    const enforces = (ctor as any)[EnforceObservableSubclassesSymbol] ?? false

    lines.push(
      `  ${" ".repeat(
        depth * 2,
      )}↳ ${name} | observable: ${isObservable} | enforceSubclasses: ${enforces}`,
    )

    proto = Object.getPrototypeOf(proto)
    depth++
  }

  return lines.join("\n")
}

/**
 * This is the underlying implementation of `@ga.observableClass`.
 * DO NOT use this directly - import via `ga` instead.
 *
 * Classes decorated by this must implement an `addDestructor()` method for use in cleaning up
 * computeds, which can cause memory leaks if not cleaned up. Advanced users can opt to stub
 * this method for classes without computeds or without memory leak risk. See `destroyComputed()`
 * for more details on cleaning up computeds.
 *
 * Classes can also optionally implement `afterObservable()` as a callback to run exactly once
 * after the class has been made observable by this decorator.
 *
 * Code inside a decorated class body must not assume which class a static-time `this` is.
 * Compilers (esbuild and SWC among them) disagree on whether a static initializer's `this` is the
 * original class or the wrapper this decorator returns, and on when class-decorator initializers
 * fire relative to it. Both prototypes are in every instance's chain: register on
 * `this.prototype`, read through the chain, and never `Object.hasOwn(ExportedClass, ...)`.
 */
export const __observableClass = <TClass extends ObservableClass>(
  OriginalClass: TClass,
  _context: ClassDecoratorContext,
  options?: { enforceSubclasses?: boolean },
) => {
  const wrapped = createObservableClass(OriginalClass, DEFAULT_EXCLUDES)

  if (options?.enforceSubclasses === false) {
    wrapped[EnforceObservableSubclassesSymbol] = false
  }
  return wrapped
}

/**
 * This is the underlying implementation of `@ga.observableClass.exclude()`.
 * DO NOT use this directly - import via `ga` instead.
 *
 * See `__observableClass` for more.
 */
export const __observableClassExcluding = <TClass extends ObservableClass>(
  excludes: (string | symbol)[],
  options?: { enforceSubclasses?: boolean },
): ((OriginalClass: TClass, _context: ClassDecoratorContext) => TClass) => {
  const allExcludes = excludes.concat(DEFAULT_EXCLUDES)
  return function (OriginalClass: TClass, _context: ClassDecoratorContext) {
    const wrapped = createObservableClass(OriginalClass, allExcludes)

    if (options?.enforceSubclasses === false) {
      wrapped[EnforceObservableSubclassesSymbol] = false
    }

    return wrapped
  }
}

/**
 * This is the underlying implementation of `@ga.observableClass.includeOnly()`.
 * DO NOT use this directly - import via `ga` instead.
 *
 * See `__observableClass` for more.
 */
export const __observableClassIncludingOnly = <TClass extends ObservableClass>(
  includes: (string | symbol)[],
  options?: { enforceSubclasses?: boolean; skipMe?: boolean },
): ((OriginalClass: TClass, _context: ClassDecoratorContext) => TClass) =>
  function (OriginalClass: TClass, _context: ClassDecoratorContext) {
    const wrapped = createObservableClass(OriginalClass, DEFAULT_EXCLUDES, includes)

    if (options?.enforceSubclasses === false) {
      wrapped[EnforceObservableSubclassesSymbol] = false
    }

    return wrapped
  }

export type ObservableClassDecoratorOptions = { enforceSubclasses?: boolean }

// Overload when used directly as a decorator: @ga.observableClass
export function __observableClassFactory<TClass extends ObservableClass>(
  target: TClass,
  context: ClassDecoratorContext,
): TClass

// Overload when used as a decorator factory: @ga.observableClass({ enforceSubclasses: true })
export function __observableClassFactory<TClass extends ObservableClass>(
  options: ObservableClassDecoratorOptions,
): (target: TClass, context: ClassDecoratorContext) => TClass

// Implementation
// eslint-disable-next-line func-style -- TS overloads need a function declaration
export function __observableClassFactory<TClass extends ObservableClass>(
  optionsOrTarget?: ObservableClassDecoratorOptions | TClass,
  maybeContext?: ClassDecoratorContext,
): TClass | ((target: TClass, context: ClassDecoratorContext) => TClass) {
  if (typeof optionsOrTarget === "function") {
    if (!maybeContext) throw new Error("Missing context in direct decorator call")
    return __observableClass(optionsOrTarget, maybeContext)
  }

  return (target: TClass, context: ClassDecoratorContext): TClass =>
    __observableClass(target, context, optionsOrTarget)
}
