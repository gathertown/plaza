import { isComputed, isObservable, isObservableProp, runInAction } from "mobx"

import { getMobxAutoDataObservables } from "../getMobxAutoDataObservables"
import { makeDataAutoObservable, MOBX_REF_DATA_KEYS } from "../makeDataAutoObservable"

// Spy on `getMobxAutoDataObservables` without changing its impl
jest.mock("../getMobxAutoDataObservables", () => ({
  getMobxAutoDataObservables: jest
    .fn()
    .mockImplementation(
      jest.requireActual("../getMobxAutoDataObservables").getMobxAutoDataObservables,
    ),
}))

it("works on plain objects", () => {
  const obj = { a: 1, f() {} }
  makeDataAutoObservable(obj)

  expect(isObservable(obj)).toEqual(true)
  expect(isObservableProp(obj, "a")).toEqual(true)
  expect(isObservableProp(obj, "f")).toEqual(false)
  expect(obj.a).toEqual(1)

  runInAction(() => (obj.a = 2))
  expect(obj.a).toEqual(2)

  // Try a differently-shaped object to make sure nothing weird happens from caching
  const obj2 = { b: "" }
  makeDataAutoObservable(obj2)

  expect(isObservable(obj2)).toEqual(true)
  expect(isObservableProp(obj2, "b")).toEqual(true)
})

it("works on class instances", () => {
  class MyClass {
    a = 1

    constructor(private b: number) {}

    get bValue() {
      return this.b
    }

    increment() {
      runInAction(() => this.a++)
    }
  }

  const obj = new MyClass(0)
  const obj2 = new MyClass(0)

  makeDataAutoObservable(obj)
  expect(jest.mocked(getMobxAutoDataObservables)).toHaveBeenCalledOnce()

  // Expect `makeDataAutoObservable` to use the prototype cache this time
  jest.mocked(getMobxAutoDataObservables).mockClear()
  makeDataAutoObservable(obj2)
  expect(jest.mocked(getMobxAutoDataObservables)).not.toHaveBeenCalled()

  expect(isObservable(obj)).toEqual(true)
  expect(isObservableProp(obj, "a")).toEqual(true)
  expect(isObservableProp(obj, "b")).toEqual(true)
  expect(isComputed(obj.bValue)).toEqual(false)

  expect(obj.a).toEqual(1)
  obj.increment()
  expect(obj.a).toEqual(2)
})

it("supports excludes", () => {
  const obj = { a: 1, b: 2 }
  makeDataAutoObservable(obj, new Set(["a"]))

  expect(isObservableProp(obj, "a")).toEqual(false)
  expect(isObservableProp(obj, "b")).toEqual(true)
})

it("supports excluding Set and Map fields", () => {
  const obj = {
    trackedSet: new Set([1, 2, 3]),
    trackedMap: new Map([["a", 1]]),
    excludedSet: new Set(["x"]),
    excludedMap: new Map([["b", 2]]),
  }
  makeDataAutoObservable(obj, new Set(["excludedSet", "excludedMap"]))

  expect(isObservableProp(obj, "trackedSet")).toEqual(true)
  expect(isObservableProp(obj, "trackedMap")).toEqual(true)
  expect(isObservableProp(obj, "excludedSet")).toEqual(false)
  expect(isObservableProp(obj, "excludedMap")).toEqual(false)

  expect(obj.excludedSet).toBeInstanceOf(Set)
  expect(obj.excludedMap).toBeInstanceOf(Map)
})

it("works with class inheritance", () => {
  class Parent {
    a = 1
  }

  class Child extends Parent {
    b = 2
  }

  const p = new Parent()
  makeDataAutoObservable(p)
  expect(isObservableProp(p, "a")).toEqual(true)

  // Make sure annotations caching uses a separate cache for Child
  const c = new Child()
  makeDataAutoObservable(c)
  expect(isObservableProp(c, "a")).toEqual(true)
  expect(isObservableProp(c, "b")).toEqual(true)
})

describe("`MOBX_REF_DATA_KEYS` precedence", () => {
  // Framework-level ref keys are a DEFAULT — explicit caller intent via `excludes` or `includeOnly` must still win.

  it("applies observable.ref for keys listed in the static `MOBX_REF_DATA_KEYS`", () => {
    class WithRefKey {
      a = { nested: 1 }
      b = { deep: { value: 2 } }
      static [MOBX_REF_DATA_KEYS] = new Set<string | symbol>(["a"])
    }

    const instance = new WithRefKey()
    makeDataAutoObservable(instance)

    // `a` is observable at the property level (ref atom fires on reassignment)...
    expect(isObservableProp(instance, "a")).toEqual(true)
    // ...but its inner value is NOT deep-observed.
    expect(isObservable(instance.a)).toEqual(false)

    // `b` is not in ref-keys — gets the default deep observable.
    expect(isObservableProp(instance, "b")).toEqual(true)
    expect(isObservable(instance.b)).toEqual(true)
  })

  it("respects excludes over ref-key overrides (explicit exclude wins)", () => {
    class ExcludedRefKey {
      a = { nested: 1 }
      b = 2
      static [MOBX_REF_DATA_KEYS] = new Set<string | symbol>(["a"])
    }

    const instance = new ExcludedRefKey()
    // Caller explicitly excludes `a`, intent is "no observability at all on this field"
    makeDataAutoObservable(instance, new Set(["a"]))

    expect(isObservableProp(instance, "a")).toEqual(false)
    expect(isObservableProp(instance, "b")).toEqual(true)
  })

  it("respects includeOnly over ref-key overrides (fields outside includeOnly stay excluded)", () => {
    class IncludeOnlyWithRefKey {
      a = { nested: 1 }
      b = 2
      c = 3
      static schema = { shape: { a: null, b: null, c: null } }
      static [MOBX_REF_DATA_KEYS] = new Set<string | symbol>(["a"])
    }

    const instance = new IncludeOnlyWithRefKey()
    // Caller says "only `b` should be observable". `a` is in ref-keys but NOT in `includeOnly`
    makeDataAutoObservable(instance, undefined, ["b"])

    expect(isObservableProp(instance, "a")).toEqual(false)
    expect(isObservableProp(instance, "b")).toEqual(true)
    expect(isObservableProp(instance, "c")).toEqual(false)
  })

  it("applies observable.ref when a key is in BOTH includeOnly and ref-keys", () => {
    class IncludeOnlyIntersectingRefKey {
      a = { nested: 1 }
      b = 2
      static schema = { shape: { a: null, b: null } }
      static [MOBX_REF_DATA_KEYS] = new Set<string | symbol>(["a"])
    }

    const instance = new IncludeOnlyIntersectingRefKey()
    // Caller includes `a`, and it's a ref-key. It should be ref-observable:
    // the property atom fires on reassignment, inner value is plain JS.
    makeDataAutoObservable(instance, undefined, ["a"])

    expect(isObservableProp(instance, "a")).toEqual(true)
    expect(isObservable(instance.a)).toEqual(false)
    expect(isObservableProp(instance, "b")).toEqual(false)
  })
})
