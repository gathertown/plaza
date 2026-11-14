import { guaranteedError } from "./errors"
import { isUndefined } from "./fpHelpers"

export const MOBX_REACTION_ERROR_PREFIX = "[MobxReactionError]"

/**
 * The reaction name goes in the message (not only in attributes) so an error tracker groups errors
 * per reaction. Reaction names are static code identifiers — a bounded set — so this doesn't
 * fragment message-based grouping the way interpolating IDs would.
 */
export const mobxReactionErrorMessage = (reactionName: string): string =>
  `${MOBX_REACTION_ERROR_PREFIX} ${reactionName}`

export const MobxReactionKind = {
  Reaction: "Reaction",
  Autorun: "Autorun",
  AutorunAsync: "AutorunAsync",
  Global: "Global",
} as const satisfies Record<string, string>
export type MobxReactionKind = (typeof MobxReactionKind)[keyof typeof MobxReactionKind]

export type MobxReactionErrorContext = {
  reactionName: string
  kind: MobxReactionKind
  /** How many reports for this reaction were throttled since the last one. */
  suppressedCount: number
}

export type MobxReactionErrorSink = (error: Error, context: MobxReactionErrorContext) => void

const defaultSink: MobxReactionErrorSink = (error, context) =>
  console.error(mobxReactionErrorMessage(context.reactionName), context, error)

// Each runtime replaces this at init with a sink that reaches its logger. The console default
// covers processes that never register one (unit tests, scripts).
let sink: MobxReactionErrorSink = defaultSink

export const registerMobxReactionErrorSink = (newSink: MobxReactionErrorSink): void => {
  sink = newSink
}

const THROTTLE_WINDOW_MS = 60_000

type ThrottleEntry = { lastReportedAt: number; suppressedCount: number }
// Keyed by reaction name alone, which is the same granularity the reports are grouped at, so the
// map is bounded by a static set of code identifiers and needs no eviction. Keying on the error
// message too would distinguish failure modes within one reaction, but messages that interpolate
// entity IDs mint a key per ID (unbounded in a long-running process) for a distinction that never
// reaches the grouping. The cost is that a loud failure hides a rarer one in the same reaction,
// visible only as a non-zero `suppressedCount`.
const throttleEntries = new Map<string, ThrottleEntry>()

/**
 * A reaction that errors is not disposed — it re-errors on every dependency change, so one broken
 * reaction can emit thousands of identical reports. Returns the number of reports suppressed
 * since the last emitted report for this reaction, or undefined when this report should itself be
 * suppressed.
 */
const throttledSuppressedCount = (reactionName: string): number | undefined => {
  const now = Date.now()
  const entry = throttleEntries.get(reactionName)

  if (entry && now - entry.lastReportedAt < THROTTLE_WINDOW_MS) {
    entry.suppressedCount += 1
    return undefined
  }

  throttleEntries.set(reactionName, { lastReportedAt: now, suppressedCount: 0 })
  return entry?.suppressedCount ?? 0
}

export const reportMobxReactionError = (
  error: unknown,
  context: Pick<MobxReactionErrorContext, "reactionName" | "kind">,
): void => {
  try {
    const suppressedCount = throttledSuppressedCount(context.reactionName)
    if (isUndefined(suppressedCount)) return
    sink(guaranteedError(error), { ...context, suppressedCount })
  } catch {
    // Swallow deliberately: an error handler that throws inside a reaction permanently breaks that
    // reaction's reactivity, so reporting must never take the reaction down.
  }
}

export const resetMobxReactionErrorReportingForTesting = (): void => {
  sink = defaultSink
  throttleEntries.clear()
}
