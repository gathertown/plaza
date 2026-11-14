import { action, actionBound, NoPromise } from "../mobx-utils"
import { getOrCreateObsClassInternalData } from "./internals"

/**
 * createActionDecorator is a factory for __action that captures generic arguments. Since __action
 * is used as a decorator, we can't capture the generic arguments directly in the decorator
 * function.
 */
const createActionDecorator = <AllowPromise extends boolean = false>(
  actionFactory: typeof action | typeof actionBound,
) =>
  function __action<TRet>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _originalMethod: (...args: any[]) => AllowPromise extends true ? TRet : NoPromise<TRet>,
    context: ClassMethodDecoratorContext,
  ): void {
    context.addInitializer(function () {
      // Mark this method as an `action` on the class prototype.
      getOrCreateObsClassInternalData(this).annotations[context.name] = actionFactory
    })
  }

/**
 * This is the underlying implementation of `@ga.action`.
 * DO NOT use this directly - import via `ga` instead.
 *
 * This decorator relies on the class it's applied to being decorated with `@ga.observableClass`.
 * This is a no-op otherwise.
 *
 * This decorator does not work on async methods! If you're trying to wrap async mutations in MobX actions,
 * either do it directly via `runInAction()` or use `@ga.flow` instead.
 *
 * This decorator marks the method as a MobX action using `makeObservable()` under the hood.
 * This functions effectively the same as `@action` from MobX.
 */
export const __action = createActionDecorator<false>(action)

/**
 * This is the underlying implementation of `@ga.action.allowPromiseReturn`.
 * DO NOT use this directly - import via `ga` instead.
 *
 * `@ga.action.allowPromiseReturn` is identical to `ga.action` but it ignores our deliberate
 * type checks that disallow Promise returns. `@ga.action` explicitly should *not* be used on
 * async functions, but in rare cases it may be valid to have a sync function return a Promise.
 * Be careful when using this!
 */
export const __actionAllowPromiseReturn = createActionDecorator<true>(action)

/**
 * This is the underlying implementation of `@ga.action.bound`.
 * DO NOT use this directly - import via `ga` instead.
 *
 * This decorator relies on the class it's applied to being decorated with `@ga.observableClass`.
 * This is a no-op otherwise.
 *
 * This decorator does not work on async methods! If you're trying to wrap async mutations in MobX actions,
 * either do it directly via `runInAction()` or use `@ga.flow` instead.
 *
 * This decorator marks the method as a MobX action using `makeObservable()` under the hood, and also auto-binds it.
 * This functions effectively the same as `@action.bound` from MobX.
 */
export const __actionBound = createActionDecorator<false>(actionBound)
