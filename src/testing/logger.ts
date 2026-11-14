/* eslint-disable @typescript-eslint/no-explicit-any */

import { head } from "ramda"

import {
  registerMobxReactionErrorSink,
  resetMobxReactionErrorReportingForTesting,
} from "../helpers"

const util = require("util")

let checkFunctions: (() => void)[] = []
// Teardown that must happen even when a check above it fails. Spies don't need this — jest's
// `restoreMocks` undoes them regardless — but anything that mutates process-wide state does.
let cleanupFunctions: (() => void)[] = []
let errorSilencingInitialized = false

type MobxReactionErrorSilencing = { silencedMessages: string[]; reportedMessages: string[] }
// There's one process-wide reaction error sink, so a test gets one set of silenced messages and one
// set of reports no matter how many times it silences.
let mobxReactionErrorSilencing: MobxReactionErrorSilencing | undefined

const checkMessage = (message: string | object) =>
  typeof message === "string" ? expect.stringContaining(message) : expect.objectContaining(message)

export const silenceExpected = <TestLoggerT extends object>(
  logger: TestLoggerT,
  method: keyof TestLoggerT & string,
  ...messages: (string | Record<string, any>)[]
) =>
  silenceErrors(
    logger,
    method,
    ...messages.map((message) =>
      Array.isArray(message) ? message.map(checkMessage) : checkMessage(message),
    ),
  )

export const silenceErrors = <TestLoggerT extends object>(
  logger: TestLoggerT,
  method: keyof TestLoggerT & string,
  ...messages: any[]
) => {
  ensureSystemInitialized()
  // TypeScript isn't happy with the generic type here, but we know that the method is a key of
  // GenericLogger which must exist on the logger object.
  // @ts-expect-error
  const loggerSpy = jest.spyOn(logger, method).mockImplementation(() => {})
  checkFunctions.push(() => {
    messages.forEach((message) => {
      // NOTE:
      // - we aren't using 'toHaveBeenNthCalledWith' to check order to prevent future flakes where
      //   async code might log in a different order
      // - we are allowing duplicate 'messages' which introduces an issue that multiple 'message's
      //   could match the same error log and since the message count and error count matches below
      //   this check passes but we might have had an error logged that we didn't expect
      if (Array.isArray(message)) {
        expect(loggerSpy).toHaveBeenCalledWith(...message)
      } else {
        // If we only have a string as the message to check, we look for a string containing that
        // message in the first argument only of the log call. This makes it easier to match logs
        // that log other things like objects without having to specify the entire log call. If we
        // do want to check for these, we can use the array format that's handled in the block
        // above.
        // Eg. silenceErrors(logger, "error", "an error message") will match
        // console.error("an error message", { some: "context" })
        const firstArgumentsOfEachCall = loggerSpy.mock.calls.map((params) => head(params))

        expect(firstArgumentsOfEachCall).toEqual(expect.arrayContaining([message]))
      }
    })
    try {
      expect(loggerSpy).toHaveBeenCalledTimes(messages.length)
    } catch (e) {
      throw new Error(
        `Logger was called with ${loggerSpy.mock.calls.length} errors but expected ${
          messages.length
        } calls.  These were the actual calls: ${util.inspect(loggerSpy.mock.calls)}`,
      )
    }
  })
}

/**
 * Silences the MobX reaction error reports a test provokes, matching on the underlying error
 * message rather than on the name of every reaction that reported it.
 *
 * Reach for this when the behavior under test deliberately holds a state that unrelated reactions
 * observe. Reports matching none of the messages still fail the test, and at least one report has
 * to fire. Repeated calls in one test add to the same set of silenced messages.
 *
 * ```ts
 * silenceMobxReactionErrors("Message length is too long")
 * const message = await Message.create({ text: "a".repeat(12001) })
 * ```
 *
 * `silenceLoggerErrors` can't express that. Reports reach it as
 * `console.error("[MobxReactionError] <reactionName>", context, error)`, and it matches the first
 * argument with an exact call count — so it silences by reaction name while the test cares about
 * the error message:
 *
 * ```ts
 * silenceLoggerErrors(
 *   "[MobxReactionError] Message.invariants",
 *   "[MobxReactionError] ThreadRepo.replyCountAutorun",
 * )
 * ```
 *
 * One violated invariant fans out to every reaction reading that state, so the test has to name
 * them all and goes red the day someone adds another — a message-length test broken by an
 * unrelated feature.
 */
export const silenceMobxReactionErrors = (...messages: string[]) => {
  ensureSystemInitialized()
  const silencing = mobxReactionErrorSilencing ?? startMobxReactionErrorSilencing()
  silencing.silencedMessages.push(...messages)
}

const startMobxReactionErrorSilencing = (): MobxReactionErrorSilencing => {
  const silencing: MobxReactionErrorSilencing = { silencedMessages: [], reportedMessages: [] }
  mobxReactionErrorSilencing = silencing

  registerMobxReactionErrorSink((error) => {
    silencing.reportedMessages.push(error.message)
  })

  // The sink is process-wide, so it has to come back off even when an earlier check fails and
  // aborts the rest — otherwise every later test in the run silently swallows reaction errors.
  cleanupFunctions.push(() => {
    mobxReactionErrorSilencing = undefined
    resetMobxReactionErrorReportingForTesting()
  })

  checkFunctions.push(() => {
    const unexpected = silencing.reportedMessages.filter(
      (reported) => !silencing.silencedMessages.some((message) => reported.includes(message)),
    )
    expect(unexpected).toEqual([])
    expect(silencing.reportedMessages).not.toEqual([])
  })

  return silencing
}

export const setUpErrorSilencing = () => {
  errorSilencingInitialized = true
  afterEach(() => {
    const localCheckFunctions = checkFunctions
    const localCleanupFunctions = cleanupFunctions
    checkFunctions = []
    cleanupFunctions = []
    try {
      localCheckFunctions.forEach((check) => {
        check()
      })
    } finally {
      localCleanupFunctions.forEach((cleanup) => {
        cleanup()
      })
    }
  })
}

const ensureSystemInitialized = () => {
  if (!errorSilencingInitialized) {
    throw new Error(`
You're silencing errors, but you need to initialize the silencing system.
At the top of the file, inside the test describe block, add this line:

    describe('some/test/file', () => {
      setupErrorSilencing()

      // rest of test file
    })`)
  }
}

/** Silences lines plaza logs to `console`, and fails if they don't come. */
export const silenceLoggerErrors = (...messages: string[]) =>
  silenceExpected(console, "error", ...messages)

export const silenceLoggerWarnings = (...messages: string[]) =>
  silenceExpected(console, "warn", ...messages)
