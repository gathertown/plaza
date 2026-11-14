import { onReactionError } from "mobx"

import {
  MobxReactionErrorSink,
  MobxReactionKind,
  registerMobxReactionErrorSink,
  reportMobxReactionError,
  VoidFunction,
} from "../helpers"

/**
 * Installs the global backstop for reactions created outside our wrappers (raw mobx call sites and
 * `when()`). Wrapped sites never reach it: a per-reaction `onError` makes MobX skip global
 * handlers, so nothing double-reports.
 *
 * Only this piece imports mobx. The sink, throttle and message format sit in `/helpers`, so code
 * that never loads mobx can report through them.
 *
 * Call once at app init. Returns the mobx disposer — production callers ignore it; tests use it.
 */
export const registerMobxReactionErrorReporting = (
  newSink?: MobxReactionErrorSink,
): VoidFunction => {
  if (newSink) {
    registerMobxReactionErrorSink(newSink)
  }
  return onReactionError((error, derivation) =>
    reportMobxReactionError(error, {
      reactionName: derivation.name_,
      kind: MobxReactionKind.Global,
    }),
  )
}
