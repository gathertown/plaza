import { VoidFunction } from "../helpers"
import { ga } from "./decorators"

@ga.observableClass.exclude(["_destructors", "_isDestroyed"], { enforceSubclasses: false })
export class Destructible {
  private _destructors: VoidFunction[] = []
  protected get destructors(): readonly VoidFunction[] {
    return this._destructors
  }

  private _isDestroyed = false
  get isDestroyed(): boolean {
    return this._isDestroyed
  }

  constructor() {
    // This is done in the constructor instead of defining `destroy` as `destroy = () => { … }`
    // because we want subclasses to be able to override `destroy` and call super.destroy().
    this.destroy = this.destroy.bind(this)
  }

  /**
   * Adds a single destructor to be called during invocation of `destroy()`.
   */
  addDestructor(destructor: VoidFunction) {
    this.addDestructors(destructor)
  }

  /**
   * Adds one or more destructors to be called during invocation of `destroy()`.
   */
  addDestructors(...destructors: VoidFunction[]) {
    this._destructors.push(...destructors)
  }

  protected resetDestroyed() {
    this._isDestroyed = false
  }

  /**
   * Invokes and clears all destructors added to this instance.
   * Auto-bound for ease of use in `start()`-like methods:
   *
   *     return this.destroy // will always run with the correct `this`
   */
  destroy() {
    if (this._isDestroyed) return
    this._isDestroyed = true

    const destructors = this._destructors
    this._destructors = []

    const errors: unknown[] = []
    for (const f of destructors) {
      try {
        f()
      } catch (e) {
        errors.push(e)
      }
    }

    if (errors.length === 1) throw errors[0]
    if (errors.length > 1)
      throw new AggregateError(errors, "Multiple destructors threw during destroy()")
  }
}
