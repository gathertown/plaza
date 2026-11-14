import { observable, ObservableMap } from "mobx"

import { NotAutoDataObservableSymbol } from "../getMobxAutoDataObservables"
import {
  MapRecordSource,
  observableMapAsRecord,
  observableMapAsRecordFrom,
  UnderlyingObservableMapSymbol,
} from "../observableMapAsRecord"

describe("observableMapAsRecord", () => {
  type TestItem = { name: string; value: number }
  let map: ObservableMap<string, TestItem>
  let record: Readonly<Record<string, TestItem>>

  beforeEach(() => {
    map = observable.map<string, TestItem>()
    map.set("item1", { name: "foo", value: 1 })
    map.set("item2", { name: "bar", value: 2 })
    record = observableMapAsRecord(map)
  })

  describe("property access", () => {
    it("provides object-like property access via record[key]", () => {
      expect(record["item1"]).toEqual({ name: "foo", value: 1 })
      expect(record["item2"]).toEqual({ name: "bar", value: 2 })
    })

    it("returns undefined for non-existent keys", () => {
      expect(record["nonexistent"]).toEqual(undefined)
    })

    it("reflects changes to the underlying map", () => {
      map.set("item1", { name: "updated", value: 99 })
      expect(record["item1"]).toEqual({ name: "updated", value: 99 })
    })

    it("reflects new entries added to the map", () => {
      map.set("item3", { name: "new", value: 3 })
      expect(record["item3"]).toEqual({ name: "new", value: 3 })
    })

    it("reflects deletions from the map", () => {
      map.delete("item1")
      expect(record["item1"]).toEqual(undefined)
    })
  })

  describe("has (in operator)", () => {
    it("returns true for existing keys", () => {
      expect("item1" in record).toEqual(true)
      expect("item2" in record).toEqual(true)
    })

    it("returns false for non-existent keys", () => {
      expect("nonexistent" in record).toEqual(false)
    })

    it("returns false for symbol keys", () => {
      expect(Symbol("test") in record).toEqual(false)
    })
  })

  describe("ownKeys (Object.keys)", () => {
    it("returns all keys from the map", () => {
      expect(Object.keys(record).sort()).toEqual(["item1", "item2"])
    })

    it("reflects changes to the map", () => {
      map.set("item3", { name: "new", value: 3 })
      map.delete("item1")
      expect(Object.keys(record).sort()).toEqual(["item2", "item3"])
    })
  })

  describe("getOwnPropertyDescriptor", () => {
    it("returns accessor descriptors for existing keys", () => {
      const descriptor = Object.getOwnPropertyDescriptor(record, "item1")
      expect("get" in (descriptor ?? {})).toEqual(true)
      expect("set" in (descriptor ?? {})).toEqual(true)
      expect("value" in (descriptor ?? {})).toEqual(false)
      expect(descriptor?.enumerable).toEqual(true)
      expect(descriptor?.configurable).toEqual(true)
    })

    it("getter returns current value from map", () => {
      const descriptor = Object.getOwnPropertyDescriptor(record, "item1")
      expect(descriptor?.get?.()).toEqual({ name: "foo", value: 1 })

      // Update map and verify getter returns new value.
      map.set("item1", { name: "updated", value: 99 })
      expect(descriptor?.get?.()).toEqual({ name: "updated", value: 99 })
    })

    it("setter throws error", () => {
      const descriptor = Object.getOwnPropertyDescriptor(record, "item1")
      expect(() => descriptor?.set?.({ name: "hacked", value: 0 })).toThrow(/Cannot modify/)
    })

    it("returns undefined for non-existent keys", () => {
      expect(Object.getOwnPropertyDescriptor(record, "nonexistent")).toEqual(undefined)
    })
  })

  describe("Jest equality", () => {
    it("passes toEqual checks against equivalent plain objects", () => {
      expect(record).toEqual({ item1: { name: "foo", value: 1 }, item2: { name: "bar", value: 2 } })
    })

    it("has Object as Symbol.toStringTag", () => {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
      expect((record as any)[Symbol.toStringTag]).toEqual("Object")
    })

    it("does not expose Map-specific methods", () => {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
      const r = record as any
      expect(r.entries).toEqual(undefined)
      expect(r.values).toEqual(undefined)
      expect(r.keys).toEqual(undefined)
      expect(r.forEach).toEqual(undefined)
    })
  })

  describe("UnderlyingObservableMapSymbol", () => {
    it("exposes the underlying ObservableMap via symbol", () => {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
      const underlying = (record as any)[UnderlyingObservableMapSymbol]
      expect(underlying).toBe(map)
    })
  })

  describe("NotAutoDataObservableSymbol", () => {
    it("returns true to skip auto-observable wrapping", () => {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
      expect((record as any)[NotAutoDataObservableSymbol]).toEqual(true)
    })
  })

  describe("read-only enforcement", () => {
    it("answers Object.isExtensible instead of tripping the Proxy invariant", () => {
      expect(Object.isExtensible(record)).toEqual(true)
    })

    it("throws on property assignment", () => {
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
        ;(record as any)["item1"] = { name: "hacked", value: 0 }
      }).toThrow(/Cannot modify/)
    })

    it("throws on property deletion", () => {
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
        delete (record as any)["item1"]
      }).toThrow(/Cannot modify/)
    })

    it("throws on defineProperty", () => {
      expect(() => {
        Object.defineProperty(record, "item3", { value: { name: "new", value: 3 } })
      }).toThrow(/Cannot modify/)
    })
  })

  describe("prototype", () => {
    it("has Object.prototype as prototype", () => {
      expect(Object.getPrototypeOf(record)).toBe(Object.prototype)
    })
  })
})

describe("observableMapAsRecordFrom", () => {
  type TestItem = { name: string; value: number }

  it("does not call getMap until property access", () => {
    const getMap = jest.fn(() => observable.map<string, TestItem>())
    const record = observableMapAsRecordFrom({ getMap })

    expect(getMap).not.toHaveBeenCalled()

    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    record["item1"]
    expect(getMap).toHaveBeenCalled()
  })

  it("does not call getMap for getPrototypeOf (avoids early initialization)", () => {
    const getMap = jest.fn(() => observable.map<string, TestItem>())
    const record = observableMapAsRecordFrom({ getMap })

    Object.getPrototypeOf(record)
    expect(getMap).not.toHaveBeenCalled()
  })

  it("calls getMap on each property access (no caching)", () => {
    let callCount = 0
    const map = observable.map<string, TestItem>()
    map.set("item1", { name: "foo", value: 1 })

    const getMap = jest.fn(() => {
      callCount++
      return map
    })
    const record = observableMapAsRecordFrom({ getMap })

    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    record["item1"]
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    record["item1"]

    expect(callCount).toEqual(2)
  })

  it("provides the same functionality as observableMapAsRecord", () => {
    const map = observable.map<string, TestItem>()
    map.set("item1", { name: "foo", value: 1 })

    const record = observableMapAsRecordFrom({ getMap: () => map })

    expect(record["item1"]).toEqual({ name: "foo", value: 1 })
    expect("item1" in record).toEqual(true)
    expect(Object.keys(record)).toEqual(["item1"])
  })

  describe("a source with fields of its own", () => {
    class SourceWithFields implements MapRecordSource<string, TestItem> {
      constructor(
        readonly index: object,
        readonly id: string,
        private readonly map: ObservableMap<string, TestItem>,
      ) {}

      getMap() {
        return this.map
      }
    }

    let map: ObservableMap<string, TestItem>
    let record: Readonly<Record<string, TestItem>>

    beforeEach(() => {
      map = observable.map<string, TestItem>()
      map.set("item1", { name: "foo", value: 1 })
      record = observableMapAsRecordFrom(new SourceWithFields({}, "source-id", map))
    })

    it("lists only the map's keys", () => {
      expect(Object.keys(record)).toEqual(["item1"])
    })

    it("does not report the source's fields as present", () => {
      expect("id" in record).toEqual(false)
      expect("index" in record).toEqual(false)
    })

    it("resolves a name that collides with a source field through the map", () => {
      expect(record["id"]).toEqual(undefined)

      map.set("id", { name: "clash", value: 9 })

      expect(record["id"]).toEqual({ name: "clash", value: 9 })
    })

    it("has no own property descriptor for a source field", () => {
      expect(Object.getOwnPropertyDescriptor(record, "id")).toEqual(undefined)
    })

    it("serializes only the map's entries", () => {
      expect(JSON.parse(JSON.stringify(record))).toEqual({ item1: { name: "foo", value: 1 } })
    })
  })
})
