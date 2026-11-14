import { isNil } from "./fpHelpers"

type MobXPerfTimelineEntryData = { duration: number; count: number }

export type MobXPerfTimelineEntry = {
  timestampMs: number
  data: Record<string, MobXPerfTimelineEntryData>
}

export type MobXPerfTimelineType = "reaction" | "autorun"

const keyFor = (name: string, type: MobXPerfTimelineType): string => `${type}:${name}`

/**
 * Fixed-capacity ring buffer. Overwrites oldest entry when full.
 */
class RingBuffer<T> {
  private readonly entries: (T | undefined)[]
  private writeIndex: number = 0
  private size: number = 0

  constructor(capacity: number) {
    this.entries = new Array(capacity)
  }

  push(entry: T): void {
    this.entries[this.writeIndex] = entry
    this.writeIndex = (this.writeIndex + 1) % this.entries.length
    if (this.size < this.entries.length) {
      ++this.size
    }
  }

  getEntries(): T[] {
    if (this.size === 0) return []
    const result: T[] = []
    const start = this.size < this.entries.length ? 0 : this.writeIndex
    for (let i = 0; i < this.size; ++i) {
      const idx = (start + i) % this.entries.length
      const entry = this.entries[idx]
      if (entry !== undefined) {
        result.push(entry)
      }
    }
    return result
  }
}

export default class MobXPerfTimelineRecorder {
  private _isActive: boolean = false
  private ringBuffer: RingBuffer<MobXPerfTimelineEntry> | null = null

  private currentBucket: Record<string, MobXPerfTimelineEntryData> = {}

  public get isActive(): boolean {
    return this._isActive
  }

  /**
   * Record a single MobX reaction or autorun execution. No-op when not active.
   */
  public recordExecution(name: string, duration: number, type: MobXPerfTimelineType): void {
    if (isNil(this.ringBuffer)) return

    const key = keyFor(name, type)

    if (isNil(this.currentBucket[key])) {
      this.currentBucket[key] = { duration: 0, count: 0 }
    }

    this.currentBucket[key].duration += duration
    this.currentBucket[key].count += 1
  }

  /**
   * Read all entries in the ring buffer, oldest first.
   */
  public getEntries(): MobXPerfTimelineEntry[] {
    return this.ringBuffer?.getEntries() ?? []
  }

  public flushCurrentBucketToRingBuffer(): void {
    if (isNil(this.ringBuffer)) return

    this.ringBuffer.push({ timestampMs: Date.now(), data: this.currentBucket })
    this.currentBucket = {}
  }

  /**
   * Start recording. Creates a ring buffer of the given size.
   * @param ringBufferSize - Capacity (number of execution entries to retain). Must be >= 1.
   * @returns Stop disposer.
   */
  start(options: { ringBufferSize: number }): () => void {
    const { ringBufferSize } = options
    if (!Number.isInteger(ringBufferSize) || ringBufferSize < 1) return () => {}

    this._isActive = true
    this.ringBuffer = new RingBuffer<MobXPerfTimelineEntry>(ringBufferSize)

    return () => {
      this._isActive = false
      this.ringBuffer = null
    }
  }
}
