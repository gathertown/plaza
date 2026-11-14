import { _getAdministration, IComputedValue, IObservableValue, isObservable } from "mobx"

export type MobxAdmin = {
  // Internal MobX objects backing the public interface of the observable
  values_: Map<string | symbol | number, IObservableValue<unknown> | IComputedValue<unknown>>
}

/**
 * Returns the MobX internal administration object for a given observable.
 * THIS IS SKETCHY and should be used only when absolutely needed! Any code in here is likely
 * to break whenever we upgrade MobX versions.
 *
 * If you need to use this:
 *   - add the minimal amount of code necessary
 *   - add test, runtime, and typing coverage for your code
 */
// MobX has no public API that lists an object's observable values, and `@ga.observableClass` needs
// them to find the keep-alive computeds it tears down on `destroy()`.
export const getMobxAdmin = (obj: object): MobxAdmin => {
  if (!isObservable(obj)) throw new Error("Object is not observable!")

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const admin = _getAdministration(obj) as object
  if (!("values_" in admin))
    throw new Error(
      `MobX admin.values_ not found! keys: ${Object.keys(admin).join(", ")} name: ${obj.constructor.name}`,
    )
  if (!(admin.values_ instanceof Map)) throw new Error("MobX admin.values_ is not a Map!")

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return admin as MobxAdmin
}
