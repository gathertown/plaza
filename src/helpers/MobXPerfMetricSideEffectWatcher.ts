import { sortBy, take } from "ramda"

import { isNil, isNotNil } from "./fpHelpers"

export type MobXPerfMetricSideEffectWatcherSnapshot = {
  totalCreatedCount: number
  totalDisposedCount: number
  totalExecutionCount: number
  totalDuration: number
  // Counts of executions exceeding the 5ms and 15ms thresholds, used to identify slow reactions/autoruns.
  totalSlowExecutionCount5ms: number
  totalSlowExecutionCount15ms: number
}

type MobXExcessiveDurationCallback = (name: string, duration: number) => void
type MobXExecutionData = { duration: number; count: number }

export default class MobXPerfMetricSideEffectWatcher {
  private _isActive: boolean = false

  private totalCreatedCount: number = 0
  private totalDisposedCount: number = 0
  private totalExecutionCount: number = 0
  private totalDuration: number = 0
  private totalSlowExecutionCount5ms: number = 0
  private totalSlowExecutionCount15ms: number = 0

  // The caller passes these in on start.
  private onExcessiveDurationCallback: MobXExcessiveDurationCallback | undefined
  private keepExecutionDetailedData: boolean = false

  private executionDetailedData: Record<string, MobXExecutionData> = {}

  public get isActive(): boolean {
    return this._isActive
  }

  public incrementTotalCreatedCount(): void {
    ++this.totalCreatedCount
  }

  public incrementTotalDisposedCount(): void {
    ++this.totalDisposedCount
  }

  public incrementTotalExecutionCount(name: string, duration: number): void {
    ++this.totalExecutionCount
    this.totalDuration += duration

    if (this.keepExecutionDetailedData) {
      if (isNil(this.executionDetailedData[name])) {
        this.executionDetailedData[name] = { duration: 0, count: 0 }
      }

      this.executionDetailedData[name].duration += duration
      this.executionDetailedData[name].count += 1
    }

    // Track slow executions exceeding 5ms/15ms thresholds.
    // A >15ms execution also counts toward the >5ms bucket.
    if (duration > 5) {
      ++this.totalSlowExecutionCount5ms

      if (isNotNil(this.onExcessiveDurationCallback)) {
        this.onExcessiveDurationCallback(name, duration)
      }
    }
    if (duration > 15) {
      ++this.totalSlowExecutionCount15ms
    }
  }

  public getMetricSnapshot(): MobXPerfMetricSideEffectWatcherSnapshot {
    return {
      totalCreatedCount: this.totalCreatedCount,
      totalDisposedCount: this.totalDisposedCount,
      totalExecutionCount: this.totalExecutionCount,
      totalDuration: this.totalDuration,
      totalSlowExecutionCount5ms: this.totalSlowExecutionCount5ms,
      totalSlowExecutionCount15ms: this.totalSlowExecutionCount15ms,
    }
  }

  // Returns the execution data for the top `limit` labels by count, or all labels if `limit` is undefined.
  public getExecutionDetailedDataLimitByCount(
    limit: number | undefined,
  ): Array<[string, MobXExecutionData]> {
    if (!this.keepExecutionDetailedData) return []

    // Send all data if no limit is provided.
    if (isNil(limit)) return Object.entries(this.executionDetailedData)

    // Otherwise sort by count and return the top `limit` records
    return take(
      limit,
      sortBy(([_, record]) => -record.count, Object.entries(this.executionDetailedData)),
    )
  }

  public clearExecutionDetailedData() {
    if (!this.keepExecutionDetailedData) return
    this.executionDetailedData = {}
  }

  start(
    options: {
      onExcessiveDurationCallback?: MobXExcessiveDurationCallback
      keepExecutionDetailedData?: boolean
    } = {},
  ) {
    this._isActive = true
    this.onExcessiveDurationCallback = options?.onExcessiveDurationCallback
    this.keepExecutionDetailedData = !!options?.keepExecutionDetailedData

    return () => {
      this._isActive = false
      this.onExcessiveDurationCallback = undefined
      this.keepExecutionDetailedData = false
    }
  }
}
