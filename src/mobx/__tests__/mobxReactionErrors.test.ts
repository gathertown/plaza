import { observable, reaction as reactionMobX, runInAction } from "mobx"

import { just, reportMobxReactionError } from "../../helpers"
import {
  mobxReactionErrorMessage,
  MobxReactionKind,
  registerMobxReactionErrorSink,
  resetMobxReactionErrorReportingForTesting,
} from "../../index"
import { setUpErrorSilencing, silenceErrors, silenceLoggerErrors } from "../../testing"
import { registerMobxReactionErrorReporting } from "../mobxReactionErrors"

describe("mobxReactionErrors", () => {
  setUpErrorSilencing()
  beforeEach(() => {
    jest.useFakeTimers()
    resetMobxReactionErrorReportingForTesting()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe("mobxReactionErrorMessage", () => {
    it("prefixes the reaction name with the stable marker", () => {
      expect(mobxReactionErrorMessage("MyReaction")).toEqual("[MobxReactionError] MyReaction")
    })
  })

  describe("reportMobxReactionError", () => {
    it("sends the error and full context to the registered sink", () => {
      const sink = jest.fn()
      registerMobxReactionErrorSink(sink)
      const error = new Error("boom")

      reportMobxReactionError(error, { reactionName: "r1", kind: MobxReactionKind.Reaction })

      expect(sink).toHaveBeenCalledTimes(1)
      expect(sink).toHaveBeenCalledWith(error, {
        reactionName: "r1",
        kind: MobxReactionKind.Reaction,
        suppressedCount: 0,
      })
    })

    it("coerces non-Error throw values via guaranteedError", () => {
      const sink = jest.fn()
      registerMobxReactionErrorSink(sink)
      silenceErrors(console, "error", expect.stringContaining("Caught error not instanceof Error"))

      reportMobxReactionError("string failure", {
        reactionName: "r1",
        kind: MobxReactionKind.Autorun,
      })

      const [errorArg] = just(sink.mock.calls[0])
      expect(errorArg).toBeInstanceOf(Error)
    })

    it("does not coerce a throttled non-Error report", () => {
      const sink = jest.fn()
      registerMobxReactionErrorSink(sink)
      // guaranteedError console.errors for non-Error values, so silencing exactly one coercion
      // proves the suppressed second report never reached it.
      silenceErrors(console, "error", expect.stringContaining("Caught error not instanceof Error"))
      const report = () =>
        reportMobxReactionError("string failure", {
          reactionName: "r1",
          kind: MobxReactionKind.Autorun,
        })

      report()
      report()

      expect(sink).toHaveBeenCalledTimes(1)
    })

    it("logs to the console via the default sink when no sink is registered", () => {
      silenceLoggerErrors("[MobxReactionError] r1")

      reportMobxReactionError(new Error("boom"), {
        reactionName: "r1",
        kind: MobxReactionKind.Reaction,
      })
    })

    it("swallows a throwing sink", () => {
      registerMobxReactionErrorSink(() => {
        throw new Error("sink exploded")
      })

      expect(() =>
        reportMobxReactionError(new Error("boom"), {
          reactionName: "r1",
          kind: MobxReactionKind.Reaction,
        }),
      ).not.toThrow()
    })
  })

  describe("throttling", () => {
    it("suppresses an identical error inside the window and reports the count after it", () => {
      const sink = jest.fn()
      registerMobxReactionErrorSink(sink)
      const report = () =>
        reportMobxReactionError(new Error("boom"), {
          reactionName: "r1",
          kind: MobxReactionKind.Reaction,
        })

      report() // reported, suppressedCount 0
      report() // suppressed
      report() // suppressed
      expect(sink).toHaveBeenCalledTimes(1)

      jest.advanceTimersByTime(60_001)
      report() // reported, carries the 2 suppressed
      expect(sink).toHaveBeenCalledTimes(2)
      expect(sink.mock.calls[1][1].suppressedCount).toEqual(2)
    })

    it("does not throttle across different reaction names", () => {
      const sink = jest.fn()
      registerMobxReactionErrorSink(sink)

      reportMobxReactionError(new Error("boom"), {
        reactionName: "r1",
        kind: MobxReactionKind.Reaction,
      })
      reportMobxReactionError(new Error("boom"), {
        reactionName: "r2",
        kind: MobxReactionKind.Reaction,
      })

      expect(sink).toHaveBeenCalledTimes(2)
    })

    it("throttles distinct error messages from the same reaction together", () => {
      const sink = jest.fn()
      registerMobxReactionErrorSink(sink)
      const report = (message: string) =>
        reportMobxReactionError(new Error(message), {
          reactionName: "r1",
          kind: MobxReactionKind.Reaction,
        })

      report("Player abc not found")
      report("Player xyz not found")
      expect(sink).toHaveBeenCalledTimes(1)

      jest.advanceTimersByTime(60_001)
      report("Player xyz not found")

      expect(sink).toHaveBeenCalledTimes(2)
      expect(sink.mock.calls[1][1].suppressedCount).toEqual(1)
    })
  })

  describe("registerMobxReactionErrorReporting (global backstop)", () => {
    it("reports raw-mobx reaction errors with kind Global and the reaction's name", () => {
      const sink = jest.fn()
      const dispose = registerMobxReactionErrorReporting(sink)
      const box = observable.box(0)
      const disposeReaction = reactionMobX(
        () => box.get(),
        (value) => {
          if (value > 0) throw new Error("raw boom")
        },
        { name: "rawReaction" },
      )

      // The raw-mobx reaction has no per-reaction onError, so mobx logs its own console.error
      // before our onReactionError handler runs.
      silenceErrors(
        console,
        "error",
        expect.stringContaining("[mobx] Encountered an uncaught exception"),
      )
      runInAction(() => box.set(1))

      expect(sink).toHaveBeenCalledTimes(1)
      expect(sink.mock.calls[0][1]).toEqual({
        reactionName: "rawReaction",
        kind: MobxReactionKind.Global,
        suppressedCount: 0,
      })
      disposeReaction()
      dispose()
    })
  })
})
