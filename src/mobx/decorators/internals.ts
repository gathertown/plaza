import { action, actionBound, flow, flowBound } from "../mobx-utils"

export const ObservableClassInternalSymbol = Symbol("ObservableClassInternal")

// The shape of the internal data stored by our `@ga` decorators on class prototypes.
export type ObservableClassInternalData = {
  readonly annotations: Record<
    string | symbol,
    typeof action | typeof actionBound | typeof flow | typeof flowBound
  >
  // `@ga.computed` keys, for the destructor and the override check. Not in `annotations`: they are
  // defined on first read.
  computeds?: Set<string | symbol>
  // TODO add flag for "done" to prevent extraneous init work
}

const initObsClassInternalData = (): ObservableClassInternalData => ({ annotations: {} })

/**
 * `ga.observableClass` relies on this function to get or create the internal data for a class.
 */
export const getOrCreateObsClassInternalData = (obj: unknown): ObservableClassInternalData => {
  const prototype = Object.getPrototypeOf(obj)
  // check if the prototype itself has an internals object yet, we don't want to use the parent's
  if (!prototype.hasOwnProperty(ObservableClassInternalSymbol)) {
    prototype[ObservableClassInternalSymbol] = initObsClassInternalData()
  }
  return prototype[ObservableClassInternalSymbol]
}
