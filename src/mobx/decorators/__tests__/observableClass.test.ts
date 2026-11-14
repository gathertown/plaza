/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { isObservableProp } from "mobx"

import { VoidFunction } from "../../../helpers"
import { getFixedClassRef } from "../../getFixedClassRef"
import { ga } from ".."
import {
  DEFAULT_EXCLUDES,
  isObservableClass,
  ObservableClassExcludesSymbol,
} from "../observableClass"

@ga.observableClass.exclude(["destructors"], { enforceSubclasses: false })
export class Destructible {
  protected destructors: VoidFunction[] = []

  addDestructor(destructor: VoidFunction) {
    this.destructors.push(destructor)
  }
}

describe("isObservableClass()", () => {
  it("returns true for @ga.observableClass", () => {
    @ga.observableClass
    class Test extends Destructible {}
    expect(isObservableClass(Destructible)).toEqual(true)
    expect(isObservableClass(Test)).toEqual(true)
  })

  it("returns false for plain classes", () => {
    class Foo {}
    expect(isObservableClass(Foo)).toEqual(false)
  })

  it("returns false for plain subclasses of observable classes", () => {
    class Undecorated extends Destructible {}
    expect(isObservableClass(Undecorated)).toEqual(false)
  })
})

describe("@ga.observableClass", () => {
  it("sets a well-scoped class name", () => {
    @ga.observableClass
    class TestClass extends Destructible {}

    expect(TestClass.name).toEqual("TestClassObservableWrapper")
  })

  it("works when creating multiple class instances", () => {
    @ga.observableClass
    class TestClass extends Destructible {
      a = 0
      b = undefined
      f() {}
    }

    const test1 = new TestClass()
    const test2 = new TestClass()

    expect(isObservableProp(test1, "a")).toEqual(true)
    expect(isObservableProp(test2, "a")).toEqual(true)
    expect(isObservableProp(test1, "b")).toEqual(true)
    expect(isObservableProp(test2, "b")).toEqual(true)
  })

  it("results in correct class references", () => {
    @ga.observableClass
    class TestClass extends Destructible {
      static a() {
        const TestClass_ = getFixedClassRef(this, TestClass)
        return new TestClass_()
      }
      b() {
        return getFixedClassRef(this, TestClass).a()
      }
    }

    @ga.observableClass
    class TestSubclass extends TestClass {
      static c() {
        const TestSubclass_ = getFixedClassRef(this, TestSubclass)
        return new TestSubclass_()
      }
      d() {
        return getFixedClassRef(this, TestSubclass).c()
      }
    }

    expect(TestClass.a()).toBeInstanceOf(TestClass)
    expect(new TestClass().b()).toBeInstanceOf(TestClass)
    expect(TestSubclass.c()).toBeInstanceOf(TestSubclass)
    expect(new TestSubclass().d()).toBeInstanceOf(TestSubclass)
  })
})

describe("@ga.observableClass.exclude()", () => {
  const getExcludesCache = (obj: any): Set<string | symbol> => obj[ObservableClassExcludesSymbol]
  const expectExcludesCache = (obj: any, values: (string | symbol)[]) => {
    const allValues = [...values, ...DEFAULT_EXCLUDES]
    const cache = getExcludesCache(obj)
    expect(cache.size).toEqual(allValues.length)
    expect(Array.from(cache)).toEqual(expect.arrayContaining(allValues))
  }

  it("allows excluding superclass keys", () => {
    class Parent extends Destructible {
      a = 0
    }
    @ga.observableClass.exclude(["a"])
    class Child extends Parent {
      b = 1
    }
    expect(isObservableProp(new Child(), "a")).toEqual(false)
  })

  it("does not make excluded keys observable, including keys from parent classes", () => {
    @ga.observableClass.exclude(["a", "b"])
    class TestClass extends Destructible {
      a = 0
      b = 1
      c = 2

      f() {}
    }

    const test = new TestClass()

    // `a` and `b` are excluded via `TestClass`
    expect(isObservableProp(test, "a")).toEqual(false)
    expect(isObservableProp(test, "b")).toEqual(false)

    // `destructors` is excluded via `Destructible`
    expect(isObservableProp(test, "destructors")).toEqual(false)

    expect(isObservableProp(test, "c")).toEqual(true)
  })

  it("works even if the observable child class doesn't invoke .exclude()", () => {
    // `Destructible` uses `@ga.observableClass.exclude()`, but `ObservableChild` does not
    @ga.observableClass
    class ObservableChild extends Destructible {}

    const test = new ObservableChild()
    expect(isObservableProp(test, "destructors")).toEqual(false)
  })

  it("works with a non-observable child class with enforcement disabled", () => {
    // The `exclude()` declared in `Destructible` should still work despite
    // `NonObsChild` not being `@ga.observableClass`
    class NonObsChild extends Destructible {}

    const test = new NonObsChild()
    expect(isObservableProp(test, "destructors")).toEqual(false)
  })

  it("shares one `excludes` cache between instances of the same model", () => {
    @ga.observableClass.exclude(["a"])
    class TestClass extends Destructible {
      a = 0
      b = 1
    }

    const test1 = new TestClass()
    const test2 = new TestClass()

    expectExcludesCache(test1, ["a", "destructors"])
    expect(getExcludesCache(test1)).toBe(getExcludesCache(test2))
  })

  it("does not share `excludes` cache between instances of parent/child classes", () => {
    @ga.observableClass.exclude(["a"])
    class Parent extends Destructible {
      a = 0
    }
    @ga.observableClass.exclude(["c"])
    class Child extends Parent {
      c = 2
    }

    const parent = new Parent()
    const child = new Child()

    expectExcludesCache(parent, ["a", "destructors"])
    expectExcludesCache(child, ["a", "c", "destructors"])
    expect(getExcludesCache(parent)).not.toBe(getExcludesCache(child))
  })
})

describe("#afterObservable", () => {
  it("is called once after the constructor", () => {
    @ga.observableClass
    class TestClass extends Destructible {
      a = 1
      afterObservable() {
        this.a++
      }
    }

    const test = new TestClass()
    expect(test.a).toEqual(2)
  })

  it("is called exactly once even with class inheritance", () => {
    @ga.observableClass
    class Parent extends Destructible {
      parentAfterObservableRan = false
      afterObservable() {
        this.parentAfterObservableRan = true
      }
    }
    @ga.observableClass
    class Child extends Parent {
      a = 1
      afterObservable() {
        this.a++
      }
    }

    const test = new Child()
    expect(test.a).toEqual(2)
    expect(test.parentAfterObservableRan).toEqual(false)
  })

  it("throws an error if the subclass is not @ga.observableClass", () => {
    @ga.observableClass
    class ParentObservable {
      constructor() {}

      addDestructor(_f: VoidFunction) {}
    }

    class ChildNotObservable extends ParentObservable {}

    expect(() => new ChildNotObservable()).toThrow()
  })

  it("is called for immutable classes", () => {
    @ga.observableClass
    class TestClass extends Destructible {
      immutable = true
      a = 1
      afterObservable() {
        this.a++
      }
    }

    const test = new TestClass()
    expect(test.a).toEqual(2)
  })
})

describe("includeOnly", () => {
  it("requires a schema to work", () => {
    @ga.observableClass.includeOnly(["a"])
    class TestClass extends Destructible {}

    expect(() => new TestClass()).toThrow(
      "called with `includeOnly` option for a class without schema",
    )
  })
})
