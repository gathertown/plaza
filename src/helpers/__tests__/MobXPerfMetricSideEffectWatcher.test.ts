import MobXPerfMetricSideEffectWatcher from "../MobXPerfMetricSideEffectWatcher"

const DEFAULT_MOBX_NAME = "test"

describe("MobXPerfMetricSideEffectWatcher", () => {
  let watcher: MobXPerfMetricSideEffectWatcher

  beforeEach(() => {
    watcher = new MobXPerfMetricSideEffectWatcher()
    watcher.start()
  })

  describe("#incrementTotalExecutionCount", () => {
    it("increments execution count and accumulates duration", () => {
      watcher.incrementTotalExecutionCount(DEFAULT_MOBX_NAME, 3)
      watcher.incrementTotalExecutionCount(DEFAULT_MOBX_NAME, 2)

      const snapshot = watcher.getMetricSnapshot()

      expect(snapshot.totalExecutionCount).toEqual(2)
      expect(snapshot.totalDuration).toEqual(5)
    })

    it("does not increment slow counts for durations at or below 5ms", () => {
      watcher.incrementTotalExecutionCount(DEFAULT_MOBX_NAME, 1)
      watcher.incrementTotalExecutionCount(DEFAULT_MOBX_NAME, 3)
      watcher.incrementTotalExecutionCount(DEFAULT_MOBX_NAME, 5)

      const snapshot = watcher.getMetricSnapshot()

      expect(snapshot.totalSlowExecutionCount5ms).toEqual(0)
      expect(snapshot.totalSlowExecutionCount15ms).toEqual(0)
    })

    it("increments only the 5ms count for durations between 5ms and 15ms exclusive", () => {
      watcher.incrementTotalExecutionCount(DEFAULT_MOBX_NAME, 6)
      watcher.incrementTotalExecutionCount(DEFAULT_MOBX_NAME, 10)
      watcher.incrementTotalExecutionCount(DEFAULT_MOBX_NAME, 15)

      const snapshot = watcher.getMetricSnapshot()

      expect(snapshot.totalSlowExecutionCount5ms).toEqual(3)
      expect(snapshot.totalSlowExecutionCount15ms).toEqual(0)
    })

    it("increments both slow counts for durations exceeding 15ms", () => {
      watcher.incrementTotalExecutionCount(DEFAULT_MOBX_NAME, 16)
      watcher.incrementTotalExecutionCount(DEFAULT_MOBX_NAME, 100)

      const snapshot = watcher.getMetricSnapshot()

      expect(snapshot.totalSlowExecutionCount5ms).toEqual(2)
      expect(snapshot.totalSlowExecutionCount15ms).toEqual(2)
    })

    it.each([
      { duration: 4, expected5ms: 0, expected15ms: 0, label: "below 5ms" },
      { duration: 5, expected5ms: 0, expected15ms: 0, label: "exactly 5ms" },
      { duration: 5.01, expected5ms: 1, expected15ms: 0, label: "just above 5ms" },
      { duration: 15, expected5ms: 1, expected15ms: 0, label: "exactly 15ms" },
      { duration: 15.01, expected5ms: 1, expected15ms: 1, label: "just above 15ms" },
      { duration: 50, expected5ms: 1, expected15ms: 1, label: "well above 15ms" },
    ])(
      "classifies $label (duration=$duration) correctly",
      ({ duration, expected5ms, expected15ms }) => {
        watcher.incrementTotalExecutionCount(DEFAULT_MOBX_NAME, duration)

        const snapshot = watcher.getMetricSnapshot()

        expect(snapshot.totalSlowExecutionCount5ms).toEqual(expected5ms)
        expect(snapshot.totalSlowExecutionCount15ms).toEqual(expected15ms)
      },
    )
  })

  describe("#getMetricSnapshot", () => {
    it("returns zero values initially", () => {
      const snapshot = watcher.getMetricSnapshot()

      expect(snapshot).toEqual({
        totalCreatedCount: 0,
        totalDisposedCount: 0,
        totalExecutionCount: 0,
        totalDuration: 0,
        totalSlowExecutionCount5ms: 0,
        totalSlowExecutionCount15ms: 0,
      })
    })

    it("includes slow execution counts in the snapshot", () => {
      watcher.incrementTotalCreatedCount()
      watcher.incrementTotalDisposedCount()
      watcher.incrementTotalExecutionCount(DEFAULT_MOBX_NAME, 3)
      watcher.incrementTotalExecutionCount(DEFAULT_MOBX_NAME, 10)
      watcher.incrementTotalExecutionCount(DEFAULT_MOBX_NAME, 20)

      const snapshot = watcher.getMetricSnapshot()

      expect(snapshot).toEqual({
        totalCreatedCount: 1,
        totalDisposedCount: 1,
        totalExecutionCount: 3,
        totalDuration: 33,
        totalSlowExecutionCount5ms: 2,
        totalSlowExecutionCount15ms: 1,
      })
    })
  })

  describe("#getExecutionDetailedDataLimitByCount", () => {
    it("returns empty when detailed data is disabled", () => {
      watcher.incrementTotalExecutionCount("a", 1)

      expect(watcher.getExecutionDetailedDataLimitByCount(undefined)).toEqual([])
      expect(watcher.getExecutionDetailedDataLimitByCount(5)).toEqual([])
    })

    it("returns empty when enabled but no executions", () => {
      watcher.start({ keepExecutionDetailedData: true })

      expect(watcher.getExecutionDetailedDataLimitByCount(undefined)).toEqual([])
      expect(watcher.getExecutionDetailedDataLimitByCount(1)).toEqual([])
    })

    it("accumulates by name when enabled", () => {
      watcher.start({ keepExecutionDetailedData: true })
      watcher.incrementTotalExecutionCount("reactionA", 10)
      watcher.incrementTotalExecutionCount("reactionA", 10)
      watcher.incrementTotalExecutionCount("reactionB", 5)

      const result = watcher.getExecutionDetailedDataLimitByCount(undefined)

      expect(result).toHaveLength(2)
      expect(result).toEqual(
        expect.arrayContaining([
          ["reactionA", { duration: 20, count: 2 }],
          ["reactionB", { duration: 5, count: 1 }],
        ]),
      )
    })

    it("respects limit and returns top entries by count descending", () => {
      watcher.start({ keepExecutionDetailedData: true })
      watcher.incrementTotalExecutionCount("reactionA", 10)
      watcher.incrementTotalExecutionCount("reactionA", 10)
      watcher.incrementTotalExecutionCount("reactionB", 5)

      expect(watcher.getExecutionDetailedDataLimitByCount(1)).toEqual([
        ["reactionA", { duration: 20, count: 2 }],
      ])
      expect(watcher.getExecutionDetailedDataLimitByCount(2)).toEqual([
        ["reactionA", { duration: 20, count: 2 }],
        ["reactionB", { duration: 5, count: 1 }],
      ])
    })

    it("returns empty when limit is 0", () => {
      watcher.start({ keepExecutionDetailedData: true })
      watcher.incrementTotalExecutionCount("a", 1)

      expect(watcher.getExecutionDetailedDataLimitByCount(0)).toEqual([])
    })

    it("returns all entries when limit is larger than entry count", () => {
      watcher.start({ keepExecutionDetailedData: true })
      watcher.incrementTotalExecutionCount("reactionA", 1)
      watcher.incrementTotalExecutionCount("reactionB", 1)

      const result = watcher.getExecutionDetailedDataLimitByCount(10)

      expect(result).toHaveLength(2)
      expect(result).toEqual(
        expect.arrayContaining([
          ["reactionA", { duration: 1, count: 1 }],
          ["reactionB", { duration: 1, count: 1 }],
        ]),
      )
    })
  })

  describe("#clearExecutionDetailedData", () => {
    it("is a no-op when detailed data is disabled", () => {
      watcher.incrementTotalExecutionCount("a", 1)
      watcher.clearExecutionDetailedData()

      expect(watcher.getExecutionDetailedDataLimitByCount(undefined)).toEqual([])
    })

    it("clears detailed data when enabled", () => {
      watcher.start({ keepExecutionDetailedData: true })
      watcher.incrementTotalExecutionCount("x", 1)

      expect(watcher.getExecutionDetailedDataLimitByCount(undefined)).toHaveLength(1)

      watcher.clearExecutionDetailedData()

      expect(watcher.getExecutionDetailedDataLimitByCount(undefined)).toEqual([])
    })

    it("allows accumulation after clear", () => {
      watcher.start({ keepExecutionDetailedData: true })
      watcher.incrementTotalExecutionCount("x", 1)
      watcher.clearExecutionDetailedData()
      watcher.incrementTotalExecutionCount("y", 2)

      const result = watcher.getExecutionDetailedDataLimitByCount(undefined)

      expect(result).toHaveLength(1)
      expect(result).toEqual([["y", { duration: 2, count: 1 }]])
    })

    it("does not change snapshot or aggregate metrics", () => {
      watcher.start({ keepExecutionDetailedData: true })
      watcher.incrementTotalExecutionCount("x", 3)
      watcher.incrementTotalExecutionCount("y", 7)

      const before = watcher.getMetricSnapshot()
      watcher.clearExecutionDetailedData()
      const after = watcher.getMetricSnapshot()

      expect(after).toEqual(before)
      expect(after.totalExecutionCount).toEqual(2)
      expect(after.totalDuration).toEqual(10)
    })
  })

  describe("#start", () => {
    it("activates the watcher and returns a cleanup function", () => {
      const cleanup = watcher.start({ onExcessiveDurationCallback: jest.fn() })

      expect(watcher.isActive).toEqual(true)

      cleanup()

      expect(watcher.isActive).toEqual(false)
      // @ts-expect-error - onExcessiveDurationCallback is private
      expect(watcher.onExcessiveDurationCallback).toEqual(undefined)
    })

    it("calls the onExcessiveDurationCallback when an excessive duration is detected", () => {
      const onExcessiveDurationCallback = jest.fn()
      watcher.start({ onExcessiveDurationCallback })

      watcher.incrementTotalExecutionCount("ExcessiveDuration", 100)

      expect(onExcessiveDurationCallback).toHaveBeenCalledWith("ExcessiveDuration", 100)
    })

    it("does not call the onExcessiveDurationCallback when a duration is below the threshold", () => {
      const onExcessiveDurationCallback = jest.fn()
      watcher.start({ onExcessiveDurationCallback })

      watcher.incrementTotalExecutionCount("ExcessiveDuration", 2)

      expect(onExcessiveDurationCallback).not.toHaveBeenCalled()
    })

    it("does not call the onExcessiveDurationCallback when the watcher is not active", () => {
      const onExcessiveDurationCallback = jest.fn()
      watcher.start({ onExcessiveDurationCallback })

      watcher.incrementTotalExecutionCount("ExcessiveDuration", 10)
    })
  })
})
