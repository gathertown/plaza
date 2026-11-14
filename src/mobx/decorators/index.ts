import { __action, __actionAllowPromiseReturn, __actionBound } from "./action"
import { __computed, __computedEquals, __computedExceptInTestsToBeSpyable } from "./computed"
import { __flow, __flowBound } from "./flow"
import {
  __observableClassExcluding,
  __observableClassFactory,
  __observableClassIncludingOnly,
} from "./observableClass"

/**
 * All custom MobX decorators we have are exported here, under the `ga` namespace.
 * The package README covers how to use these.
 *
 * Subclasses of observable classes must also be observable classes, to turn off this behavior
 * use `@ga.observableClass({ enforceSubclasses: false })`.
 *
 * We don't normally do `index.ts` barrel exports like this, but we're doing it here to
 * setup the `ga` namespace.
 */
export const ga = {
  /**
   * `@ga.observableClass` turns a class into an observable and enable the use of other `@ga`
   * decorators. Classes that use this decorator must extend `Destructible`.
   *
   * Static initializers in a decorated class body: see `__observableClass` for what they may
   * assume about `this`.
   */
  observableClass: Object.assign(__observableClassFactory, {
    /**
     * `@ga.observableClass.exclude(…)` is identical to `@ga.observableClass` except it allows
     * classes to opt out of certain properties from being made observable.
     */
    // Specifying exclude or includeOnly inline without making this an observable class isn't supported yet.
    // We currently have to do it this way because of a bug in `swc` that would break a hypothetical `@ga.exclude` decorator in tests
    exclude: __observableClassExcluding,
    /**
     * `@ga.observableClass.exclude(…)` is identical to `@ga.observableClass` except it allows
     * classes to opt out of certain properties from being made observable.
     */
    // We currently have to do it this way because of a bug in `swc` that would break a hypothetical `@ga.exclude` decorator in tests
    includeOnly: __observableClassIncludingOnly,
  }),

  /**
   * `@ga.action` turns a method into a MobX action, much the same as MobX's own `@action` decorator
   * or `makeObservable` call would.
   */
  action: Object.assign(__action, {
    /**
     * `@ga.action.bound` is the same as `ga.action` but it also binds the function to the class's
     * instance scope. This is useful for actions that are passed as event handlers.
     */
    bound: __actionBound,

    /**
     * `@ga.action.allowPromiseReturn` is identical to `ga.action` but it ignores our deliberate
     * type checks that disallow Promise returns. `@ga.action` explicitly should *not* be used on
     * async functions, but in rare cases it may be valid to have a sync function return a Promise.
     * Be careful when using this!
     */
    allowPromiseReturn: __actionAllowPromiseReturn,
  }),

  /**
   * `@ga.computed` turns a getter into a MobX `computed`. Computeds are cached and only
   * recalculated when one of the observed properties is changed. These computeds will NOT
   * suspend like standard MobX computeds.
   */
  computed: Object.assign(__computed, {
    /**
     * `@ga.computed.equals` is the same as `@ga.computed` but allows you to specify a custom
     * equality function to determine if the computed value needs to change.
     */
    equals: __computedEquals,
    exceptInTestsToBeSpyable: __computedExceptInTestsToBeSpyable,
  }),

  /**
   * `@ga.flow` turns a method into a MobX flow, much the same as MobX's own `@flow` decorator or
   * `makeObservable` call would.
   */
  flow: Object.assign(__flow, {
    /**
     * `@ga.flow.bound` is the same as `ga.flow` but it also binds the function to the class's
     * instance scope. This is useful for flow that are passed as event handlers.
     */
    bound: __flowBound,
  }),

  presenter: {
    /**
     * This is the same as `@ga.computed` but it should only be used in presenters (`@ga.computed`
     * is not allowed in a presenter).
     *
     * YOU CANNOT USE THE PRESENTER'S `this.props` INSIDE THIS COMPUTED. This is because props are
     * not observable, and using them in a computed would cause the computed value to be stale if
     * the prop value its depending on changes. Plaza has no pattern yet for a computed that
     * depends on props.
     */
    computed_DO_NOT_USE_PROPS: __computed,
  },
} as const
