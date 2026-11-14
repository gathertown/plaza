import { getMobxAutoDataObservables } from "../getMobxAutoDataObservables"

// Expects `getMobxAutoObservables(obj)` to have exactly the keys in `expected`
const expectKeys = (obj: object, expected: (string | symbol)[]) =>
  expect(new Set(getMobxAutoDataObservables(obj))).toEqual(new Set(expected))

describe("objects", () => {
  it("works on an empty object", () => {
    expectKeys({}, [])
  })

  it("works on plain objects", () => {
    expectKeys({ a: 1, b: "2" }, ["a", "b"])
  })

  it("works on symbols", () => {
    const sym = Symbol("test")
    expectKeys({ [sym]: 1 }, [sym])
  })

  it("does not include functions", () => {
    expectKeys({ a: 1, b: () => {} }, ["a"])
  })

  it("does not include jest function mocks", () => {
    expectKeys({ a: 1, b: jest.fn() }, ["a"])
  })

  it("neither includes nor invokes getters or setters", () => {
    const fn = jest.fn()
    expectKeys(
      {
        get a() {
          fn()
          return 1
        },
        set b(_x: number) {},
      },
      [],
    )
    expect(fn).not.toHaveBeenCalled()
  })
})

describe("plain classes", () => {
  it("works on an empty class", () => {
    class Test {}
    expectKeys(new Test(), [])
  })

  it("works with TS private and public fields", () => {
    class Test {
      a = 1
      private b = 2
    }
    expectKeys(new Test(), ["a", "b"])
  })

  it("does not include JS private properties", () => {
    class Test {
      #a = 1
    }
    expectKeys(new Test(), [])
  })

  it("works with nil-ish properties", () => {
    class Test {
      a = undefined
      b = null
      c = 0
    }
    expectKeys(new Test(), ["a", "b", "c"])
  })

  it("works with constructor properties", () => {
    class Test {
      c: number
      constructor(
        public a: number,
        readonly b: string,
        c: number,
      ) {
        this.c = c
      }
    }
    expectKeys(new Test(1, "2", 0), ["a", "b", "c"])
  })

  it("works with symbols", () => {
    const sym = Symbol("test")
    class Test {
      [sym] = 1
    }
    expectKeys(new Test(), [sym])
  })

  it("works with object properties", () => {
    class Test {
      a = { b: 1 }
      constructor(public b?: Test) {}
    }
    expectKeys(new Test(new Test()), ["a", "b"])
  })

  it("works with IIFE property initializers", () => {
    class Test {
      a = (() => 1)()
    }
    expectKeys(new Test(), ["a"])
  })

  it("does not include static properties", () => {
    class Test {
      static a = 1
    }
    expectKeys(new Test(), [])
  })

  it("does not include methods", () => {
    class Test {
      a = 1
      b() {}
    }
    expectKeys(new Test(), ["a"])
  })

  it("does not include getters or setters", () => {
    class Test {
      _a = 1
      get a() {
        return 1
      }
      set b(_x: number) {}
    }
    expectKeys(new Test(), ["_a"])
  })

  it("does not include properties that are functions of any kind", () => {
    class Test {
      a = () => 1
      b = async () => 1
      c = function () {}
      d = function* () {}
      e = async function () {}
      f = (() => function () {})()
      g = new Function()
    }
    expectKeys(new Test(), [])
  })
})

describe("classes with inheritance", () => {
  it("works with a single level of inheritance", () => {
    class Parent {
      a = 1
    }
    class Child extends Parent {
      b = 2
    }
    expectKeys(new Child(), ["a", "b"])
  })

  it("works with multiple levels of inheritance", () => {
    class Grandparent {
      a = 1
    }
    class Parent extends Grandparent {
      b = 2
    }
    class Child extends Parent {
      c = 3
    }
    expectKeys(new Child(), ["a", "b", "c"])
  })

  it("works with overridden properties", () => {
    class Parent {
      a = 1
      b() {}
    }
    class Child extends Parent {
      a = 2
      b() {
        return 0
      }
      c = 0
    }
    expectKeys(new Child(), ["a", "c"])
  })
})
