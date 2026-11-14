import { flow, flowBound } from "../mobx-utils"
import { getOrCreateObsClassInternalData } from "./internals"

/**
 * This is the underlying implementation of `@ga.flow`.
 * DO NOT use this directly - import via `ga` instead.
 *
 * This decorator relies on the class it's applied to being decorated with `@ga.observableClass`.
 * This is a no-op otherwise.
 *
 * This decorator marks the method as a MobX flow using `makeObservable()` under the hood.
 * This functions effectively the same as `@flow` from MobX.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const __flow = <TMethod extends (...args: any[]) => Generator>(
  _originalMethod: TMethod,
  context: ClassMethodDecoratorContext,
) => {
  context.addInitializer(function () {
    // Mark this method as a `flow` on the class prototype.
    getOrCreateObsClassInternalData(this).annotations[context.name] = flow
  })
}

/**
 * This is the underlying implementation of `@ga.flow.bound`.
 * DO NOT use this directly - import via `ga` instead.
 *
 * This decorator relies on the class it's applied to being decorated with `@ga.observableClass`.
 * This is a no-op otherwise.
 *
 * This decorator marks the method as a MobX flow using `makeObservable()` under the hood.
 * This functions effectively the same as `@flow.bound` from MobX.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const __flowBound = <TMethod extends (...args: any[]) => Generator>(
  _originalMethod: TMethod,
  context: ClassMethodDecoratorContext,
) => {
  context.addInitializer(function () {
    // Mark this method as a `flow` on the class prototype.
    getOrCreateObsClassInternalData(this).annotations[context.name] = flowBound
  })
}
