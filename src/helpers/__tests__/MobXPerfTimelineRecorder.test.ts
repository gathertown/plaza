import { just } from "../fpHelpers"
import MobXPerfTimelineRecorder from "../MobXPerfTimelineRecorder"

describe("MobXPerfTimelineRecorder", () => {
  let recorder: MobXPerfTimelineRecorder

  beforeEach(() => {
    recorder = new MobXPerfTimelineRecorder()
  })

  describe("#isActive", () => {
    it("is false before start", () => {
      expect(recorder.isActive).toEqual(false)
    })

    it("is true after start", () => {
      recorder.start({ ringBufferSize: 10 })
      expect(recorder.isActive).toEqual(true)
    })

    it("is false after stop", () => {
      const stop = recorder.start({ ringBufferSize: 10 })
      stop()
      expect(recorder.isActive).toEqual(false)
    })
  })

  describe("#recordExecution", () => {
    it("is no-op when not active", () => {
      recorder.recordExecution("foo", 5, "reaction")
      expect(recorder.getEntries()).toHaveLength(0)
    })

    it("accumulates in bucket until flush; one flush pushes one entry with aggregated data", () => {
      recorder.start({ ringBufferSize: 10 })
      recorder.recordExecution("reactionA", 3, "reaction")
      recorder.recordExecution("reactionA", 2, "reaction")
      recorder.recordExecution("autorunB", 10, "autorun")
      recorder.flushCurrentBucketToRingBuffer()

      const entries = recorder.getEntries()
      expect(entries).toHaveLength(1)
      expect(just(entries[0]).data["reaction:reactionA"]).toEqual({ duration: 5, count: 2 })
      expect(just(entries[0]).data["autorun:autorunB"]).toEqual({ duration: 10, count: 1 })
    })
  })

  describe("ring buffer overflow", () => {
    it("overwrites oldest entries when capacity exceeded", () => {
      recorder.start({ ringBufferSize: 3 })

      recorder.recordExecution("a", 1, "reaction")
      recorder.flushCurrentBucketToRingBuffer()
      recorder.recordExecution("b", 2, "reaction")
      recorder.flushCurrentBucketToRingBuffer()
      recorder.recordExecution("c", 3, "reaction")
      recorder.flushCurrentBucketToRingBuffer()

      let entries = recorder.getEntries()
      expect(entries).toHaveLength(3)
      expect(just(entries[0]).data["reaction:a"]).toBeDefined()
      expect(just(entries[2]).data["reaction:c"]).toBeDefined()

      recorder.recordExecution("d", 4, "reaction")
      recorder.flushCurrentBucketToRingBuffer()

      entries = recorder.getEntries()
      expect(entries).toHaveLength(3)
      expect(just(entries[0]).data["reaction:b"]).toBeDefined()
      expect(just(entries[2]).data["reaction:d"]).toBeDefined()
    })
  })

  describe("#flushCurrentBucketToRingBuffer", () => {
    it("pushes current bucket to ring buffer and clears bucket", () => {
      recorder.start({ ringBufferSize: 10 })
      recorder.recordExecution("x", 1, "reaction")
      recorder.flushCurrentBucketToRingBuffer()

      const entriesAfterFirstFlush = recorder.getEntries()
      expect(entriesAfterFirstFlush).toHaveLength(1)
      expect(just(entriesAfterFirstFlush[0]).data["reaction:x"]).toEqual({ duration: 1, count: 1 })

      recorder.flushCurrentBucketToRingBuffer()
      const entriesAfterSecondFlush = recorder.getEntries()
      expect(entriesAfterSecondFlush).toHaveLength(2)
      expect(Object.keys(just(entriesAfterSecondFlush[1]).data)).toHaveLength(0)
    })

    it("is no-op when not active", () => {
      recorder.recordExecution("x", 1, "reaction")
      recorder.flushCurrentBucketToRingBuffer()
      expect(recorder.getEntries()).toHaveLength(0)
    })
  })

  describe("#start", () => {
    it("returns no-op disposer when ringBufferSize is invalid", () => {
      const stop0 = recorder.start({ ringBufferSize: 0 })
      expect(recorder.isActive).toEqual(false)
      stop0()

      const stopNeg = recorder.start({ ringBufferSize: -1 })
      expect(recorder.isActive).toEqual(false)
      stopNeg()

      const stopNonInt = recorder.start({ ringBufferSize: 1.5 })
      expect(recorder.isActive).toEqual(false)
      stopNonInt()
    })
  })
})
