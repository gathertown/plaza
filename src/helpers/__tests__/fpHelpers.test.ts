import { expectTypeOf } from "expect-type"
import { always } from "ramda"

import { isUndefined, just, mapReduceKeysIntoObject } from "../fpHelpers"

describe("#just", () => {
  it("throws an error when the input is not there", () => {
    expect(() => just(undefined)).toThrow("Expected something, got nothing")
  })

  it("accepts a custom error", () => {
    expect(() => just(undefined, "Custom message")).toThrow("Custom message")
  })

  it("refines a type that is T | null to just T", () => {
    // oddly the only way to repro this problem is with a function that returns T | null,
    // a straight assignment like `const thing: string | null = ...` doesn't work.
    const getThing = (): string | null => "test"
    const thing: string | null = getThing()
    const justThing = just(thing)
    expectTypeOf(justThing).toMatchTypeOf<string>()
  })
})

describe.each([
  // [input, isUndefined]

  // null / undefined
  [null, false],
  [undefined, true],

  // strings
  ["", false],
  ["  ", false],
  ["\n\t", false],
  ["hello", false],

  // objects
  [{}, false],
  [{ a: 1 }, false],

  // arrays
  [[], false],
  [[1, 2, 3], false],

  // booleans
  [true, false],
  [false, false],

  // numbers
  [1, false],
  [-1, false],
  [0, false],
])("other cases", (a, expected) => {
  describe("#isUndefined", () => {
    it(`${JSON.stringify(a)} returns ${expected}`, () => {
      expect(isUndefined(a)).toEqual(expected)
    })
  })
})

describe("mapReduceKeysIntoObject", () => {
  it("creates a record with the same value for all keys, with a static transform", () => {
    const symbolKey = Symbol("mySymbol")
    const keys = ["name", "age", symbolKey] as const

    const result = mapReduceKeysIntoObject(keys, always("test"))

    expect(result).toEqual({ name: "test", age: "test", [symbolKey]: "test" })
    expectTypeOf<typeof result>().toMatchTypeOf<Record<"name" | "age" | typeof symbolKey, string>>()
  })

  it("applies transform function to each key", () => {
    const keys = ["name", "age"] as const

    const result = mapReduceKeysIntoObject(keys, (x) => `${x}_foo`)

    expect(result).toEqual({ name: "name_foo", age: "age_foo" })
  })

  it("uses return type of transform function", () => {
    type Keys = "name" | "age"
    const keys: Keys[] = ["name", "age"]
    const transform = (key: Keys): number | string => (key === "age" ? 42 : "test")

    const result = mapReduceKeysIntoObject(keys, transform)

    expect(result).toEqual({ name: "test", age: 42 })
    expectTypeOf<typeof result>().toMatchTypeOf<Record<"name" | "age", string | number>>()
  })
})
