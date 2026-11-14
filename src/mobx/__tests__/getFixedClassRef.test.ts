import { VoidFunction } from "../../helpers"
import { ga } from "../decorators"
import { getFixedClassRef } from "../getFixedClassRef"

class Test {
  addDestructor(_f: VoidFunction) {}

  static returnClass(): typeof Test {
    return getFixedClassRef(this, Test)
  }
  returnClass(): typeof Test {
    return getFixedClassRef(this, Test)
  }

  static invalidReturnClass() {
    return getFixedClassRef(this, class Invalid {})
  }
}

@ga.observableClass
class Decorated {
  addDestructor(_f: VoidFunction) {}

  static returnClass(): typeof Decorated {
    return getFixedClassRef(this, Decorated)
  }
  returnClass(): typeof Decorated {
    return getFixedClassRef(this, Decorated)
  }
}

@ga.observableClass
class DecoratedChild extends Decorated {
  static returnChildClass(): typeof DecoratedChild {
    return getFixedClassRef(this, DecoratedChild)
  }
  returnChildClass(): typeof DecoratedChild {
    return getFixedClassRef(this, DecoratedChild)
  }
}

it("works for a decorated class", () => {
  expect(new Decorated().returnClass()).toBe(Decorated)
  expect(Decorated.returnClass()).toBe(Decorated)
})

it("works for a decorated subclass", () => {
  expect(new DecoratedChild().returnClass()).toBe(Decorated)
  expect(DecoratedChild.returnClass()).toBe(Decorated)
  expect(new DecoratedChild().returnChildClass()).toBe(DecoratedChild)
  expect(DecoratedChild.returnChildClass()).toBe(DecoratedChild)
})

it("throws if the class isn't part of the instance's class ancestry chain", () => {
  expect(() => Test.invalidReturnClass()).toThrow(
    "The provided input with constructor type Test does not have ancestor class Invalid!",
  )
})

it("throws for a plain undecorated class", () => {
  const errMessage = "No subclass found for Test - are you sure this is a ga.observableClass?"
  expect(() => new Test().returnClass()).toThrow(errMessage)
  expect(() => Test.returnClass()).toThrow(errMessage)
})

it("returns the correct class when the class ref isn't stale", () => {
  expect(getFixedClassRef(Decorated, Decorated)).toEqual(Decorated)
})

it("returns the correct constructor for a subclass even if the class ref isn't stale", () => {
  expect(getFixedClassRef(DecoratedChild, Decorated)).toEqual(Decorated)
})
