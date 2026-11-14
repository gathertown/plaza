import {
  action,
  autorun,
  flow,
  isComputedProp,
  isObservableProp,
  makeObservable,
  observable,
} from "mobx"

import { VoidFunction } from "../../../helpers"
import { ga } from ".."
import { destroyComputed } from "../computed"
import { ObservableClassInternalSymbol } from "../internals"
import { ObservableClassExcludesSymbol } from "../observableClass"

jest.mock("mobx", () => ({
  ...jest.requireActual("mobx"),
  makeObservable: jest.fn().mockImplementation(jest.requireActual("mobx").makeObservable),
}))

jest.mock("../computed", () => ({
  ...jest.requireActual("../computed"),
  destroyComputed: jest.fn().mockImplementation(jest.requireActual("../computed").destroyComputed),
}))

@ga.observableClass
class TestClass {
  num = 0 // this should be auto-observable via `@ga.observableClass`
  private destructors: VoidFunction[] = []

  @ga.action
  increment() {
    this.num++
  }

  getNum() {
    return this.num
  }

  @ga.computed
  get number() {
    return this.num
  }

  @ga.computed
  get numberPlusOne() {
    return this.num + 1
  }

  @ga.flow
  *gen(a: number) {
    yield a
  }

  addDestructor(f: VoidFunction) {
    this.destructors.push(f)
  }

  destroy() {
    this.destructors.forEach((f) => f())
  }
}

let test: TestClass
let disposers: VoidFunction[] = []

beforeEach(() => {
  test = new TestClass()
})
afterEach(() => {
  test.destroy()

  disposers.forEach((d) => d())
  disposers = []
})

it("applies annotations from decorators on an observableClass via makeObservable()", () => {
  // `@ga.computed` getters are defined on the instance by their first read, not through the map.
  const annotations = { increment: action, gen: flow }
  expect(jest.mocked(makeObservable)).toHaveBeenCalledWith(test, {
    num: observable,
    destructors: observable,
    [ObservableClassInternalSymbol]: false,
    [ObservableClassExcludesSymbol]: false,
  })
  expect(jest.mocked(makeObservable)).toHaveBeenCalledWith(test, annotations)
  jest.mocked(makeObservable).mockClear()

  const test2 = new TestClass()
  expect(jest.mocked(makeObservable)).toHaveBeenLastCalledWith(test2, annotations)

  test2.destroy()
})

it("makes data fields observable", () => {
  const fn = jest.fn()
  disposers.push(
    autorun(() => {
      fn(test.num)
    }),
  )
  fn.mockClear()

  test.increment()

  expect(fn).toHaveBeenCalledOnceWith(1)
})

it("cleans up only own computeds on destroy", () => {
  const test2 = new TestClass()

  const fn = jest.fn()
  disposers.push(autorun(() => fn(test.number + test2.number)))
  fn.mockClear()

  test.destroy()

  expect(jest.mocked(destroyComputed)).toHaveBeenCalledOnce()

  test.increment()

  // Verify that computeds on `test` no longer react
  expect(fn).not.toHaveBeenCalled()

  test2.increment()

  // Verify that computeds on `test2` still react
  expect(fn).toHaveBeenCalledOnceWith(2)

  test2.destroy()
})

it("keeps an unread computed plain after a teardown that throws", () => {
  const fn = jest.fn()
  disposers.push(autorun(() => fn(test.number)))
  jest.mocked(destroyComputed).mockImplementationOnce(() => {
    throw new Error("teardown failed")
  })

  expect(() => test.destroy()).toThrow("teardown failed")

  const readAfterDestroy = test.numberPlusOne

  expect(readAfterDestroy).toEqual(1)
  expect(isComputedProp(test, "numberPlusOne")).toEqual(false)
})

describe("classes with ancestors", () => {
  @ga.observableClass
  class Grandparent {
    grandparentNum = 0
    protected destructors: VoidFunction[] = []

    addDestructor(f: VoidFunction) {
      this.destructors.push(f)
    }

    destroy() {
      this.destructors.forEach((f) => f())
    }
  }

  @ga.observableClass
  class Parent extends Grandparent {
    parentNum = 0

    @ga.action
    increment() {
      this.parentNum++
    }

    @ga.computed
    get number() {
      return this.parentNum
    }
  }

  @ga.observableClass
  class Child extends Parent {
    num = 0

    @ga.action
    override increment() {
      this.num++
    }

    @ga.computed
    override get number() {
      return this.num
    }

    // a computed property that doesn't exist on SecondChild
    @ga.computed
    get numPlusOne() {
      return this.num + 1
    }
  }

  @ga.observableClass
  class SecondChild extends Parent {
    secondNum = 0

    @ga.action
    increment() {
      this.secondNum++
    }

    @ga.computed
    get secondNumber() {
      return this.secondNum
    }
  }

  it("apply annotations correctly", () => {
    const c = new Child()
    expect(isObservableProp(c, "num")).toEqual(true)
    expect(isObservableProp(c, "parentNum")).toEqual(true)
    expect(isObservableProp(c, "grandparentNum")).toEqual(true)

    c.increment() // should not warn, since it's marked `@ga.action`

    const p = new Parent()
    expect(isObservableProp(p, "parentNum")).toEqual(true)
    expect(isObservableProp(p, "grandparentNum")).toEqual(true)

    p.increment() // should not warn, since it's marked `@ga.action`
  })

  it("applies annotations only to own class", () => {
    // Regression test for a bug where child classes were sharing the parent's internals object.

    // Since the internals object is lazily created in object instantiation, we need to
    // instantiate a Parent before we instantiate Child/SecondChild to reproduce the bug we had
    // where child classes were sharing the parent's internals object
    const _c = new Parent()
    const _c1 = new Child()
    // Test that the second child does not crash with computed values on fields it doesn't have
    expect(() => new SecondChild()).not.toThrow()
  })
})
