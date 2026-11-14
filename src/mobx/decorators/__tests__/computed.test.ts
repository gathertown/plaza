import {
  autorun,
  computed,
  isComputedProp as isComputedPropMobX,
  isObservableObject,
  observable,
  runInAction,
} from "mobx"

import { Destructible } from "../../Destructible"
import { comparer } from "../../mobx-utils"
import { ga } from ".."
import { destroyComputed } from "../computed"

describe("#destroyComputed", () => {
  it("causes the computed to no longer react", () => {
    const a = observable({ value: 1 })
    const b = observable({ value: 2 })
    const c = computed(() => a.value + b.value, { keepAlive: true })

    // Setup an `autorun` to observe `c`
    const fn = jest.fn()
    const dispose = autorun(() => {
      fn(c.get())
    })
    fn.mockClear()

    // Changes to `a` should trigger the `autorun`
    runInAction(() => a.value++)
    expect(fn).toHaveBeenCalledOnceWith(4)
    fn.mockClear()

    // Destroy `c` - the `autorun` should stop observing it
    destroyComputed(c)

    // Changes to `a` or `b` should no longer trigger the `autorun`
    runInAction(() => {
      a.value++
      b.value++
    })
    expect(fn).not.toHaveBeenCalled()

    dispose()
  })
})

describe("@ga.computed", () => {
  let evaluations: string[] = []

  @ga.observableClass
  class Counter extends Destructible {
    num = 1

    @ga.computed
    get doubled(): number {
      evaluations.push("doubled")
      return this.num * 2
    }

    @ga.computed
    get tripled(): number {
      evaluations.push("tripled")
      return this.num * 3
    }
  }

  beforeEach(() => {
    evaluations = []
  })

  it("does not define the computed until the getter is read", () => {
    const counter = new Counter()

    expect(isComputedPropMobX(counter, "doubled")).toEqual(false)
    expect(Object.hasOwn(counter, "doubled")).toEqual(false)
    expect(evaluations).toEqual([])
  })

  it("defines a cached computed on the first read", () => {
    const counter = new Counter()

    const first = counter.doubled
    const second = counter.doubled

    expect([first, second]).toEqual([2, 2])
    expect(isComputedPropMobX(counter, "doubled")).toEqual(true)
    expect(Object.hasOwn(counter, "doubled")).toEqual(true)
    expect(evaluations).toEqual(["doubled"])
  })

  it("reacts to dependency changes after the first read", () => {
    const counter = new Counter()
    const fn = jest.fn()
    const dispose = autorun(() => fn(counter.doubled))

    runInAction(() => {
      counter.num = 2
    })

    expect(fn.mock.calls).toEqual([[2], [4]])
    dispose()
  })

  it("does not let a first read inside a derivation track the definition", () => {
    const counter = new Counter()
    const fn = jest.fn()
    const dispose = autorun(() => fn(counter.doubled + counter.tripled))

    runInAction(() => {
      counter.num = 2
    })

    expect(fn.mock.calls).toEqual([[5], [10]])
    dispose()
  })

  it("defines the computed on a first read inside an action", () => {
    const counter = new Counter()

    const value = runInAction(() => counter.doubled)

    expect(value).toEqual(2)
    expect(isComputedPropMobX(counter, "doubled")).toEqual(true)
  })

  it("destroys only the computeds that were read", () => {
    const counter = new Counter()
    const fn = jest.fn()
    const dispose = autorun(() => fn(counter.doubled))

    counter.destroy()
    runInAction(() => {
      counter.num = 2
    })

    expect(fn).toHaveBeenCalledOnceWith(2)
    expect(isComputedPropMobX(counter, "tripled")).toEqual(false)
    dispose()
  })

  it("does not define a computed on a read after destroy", () => {
    const counter = new Counter()
    counter.destroy()

    const value = counter.doubled

    expect(value).toEqual(2)
    expect(isComputedPropMobX(counter, "doubled")).toEqual(false)
    expect(Object.hasOwn(counter, "doubled")).toEqual(false)
  })

  it("leaves the getter plain on an immutable instance", () => {
    @ga.observableClass
    class Frozen extends Destructible {
      immutable = true
      num = 1

      @ga.computed
      get doubled(): number {
        evaluations.push("doubled")
        return this.num * 2
      }
    }
    const frozen = new Frozen()

    const values = [frozen.doubled, frozen.doubled]

    expect(values).toEqual([2, 2])
    expect(isObservableObject(frozen)).toEqual(false)
    expect(Object.hasOwn(frozen, "doubled")).toEqual(false)
    expect(evaluations).toEqual(["doubled", "doubled"])
  })

  it("evaluates plainly during construction and defines the computed afterwards", () => {
    @ga.observableClass
    class Early extends Destructible {
      num = 1
      readDuringConstruction: number

      constructor() {
        super()
        this.readDuringConstruction = this.doubled
      }

      @ga.computed
      get doubled(): number {
        return this.num * 2
      }
    }
    const early = new Early()

    expect(early.readDuringConstruction).toEqual(2)
    expect(isComputedPropMobX(early, "doubled")).toEqual(false)
    expect(early.doubled).toEqual(2)
    expect(isComputedPropMobX(early, "doubled")).toEqual(true)
  })

  it("evaluates the parent getter plainly when a decorated override reads super", () => {
    @ga.observableClass
    class Parent extends Destructible {
      num = 1

      @ga.computed
      get value(): number {
        evaluations.push("parent")
        return this.num
      }
    }
    @ga.observableClass
    class Child extends Parent {
      @ga.computed
      override get value(): number {
        evaluations.push("child")
        return super.value + 1
      }
    }
    const child = new Child()
    const fn = jest.fn()
    const dispose = autorun(() => fn(child.value))

    runInAction(() => {
      child.num = 2
    })

    expect(fn.mock.calls).toEqual([[2], [3]])
    expect(evaluations).toEqual(["child", "parent", "child", "parent"])
    dispose()
  })

  it("rejects an undecorated getter overriding a @ga.computed getter", () => {
    @ga.observableClass
    class Parent extends Destructible {
      @ga.computed
      get value(): number {
        return 1
      }
    }
    const defineChild = () => {
      @ga.observableClass
      class Child extends Parent {
        override get value(): number {
          return 2
        }
      }
      return Child
    }

    expect(defineChild).toThrow(
      '"Child.value" overrides the @ga.computed getter "Parent.value" without @ga.computed',
    )
  })

  it("keeps the setter of a getter and setter pair", () => {
    @ga.observableClass
    class Named extends Destructible {
      first = "Ada"
      last = "Lovelace"

      @ga.computed
      get full(): string {
        return `${this.first} ${this.last}`
      }

      set full(value: string) {
        const [first = "", last = ""] = value.split(" ")
        this.first = first
        this.last = last
      }
    }
    const named = new Named()
    expect(named.full).toEqual("Ada Lovelace")

    named.full = "Grace Hopper"

    expect([named.first, named.last, named.full]).toEqual(["Grace", "Hopper", "Grace Hopper"])
  })

  it("does not replace an own accessor already on the instance", () => {
    const counter = new Counter()
    const spy = jest.spyOn(counter, "doubled", "get")

    const values = [counter.doubled, counter.doubled]

    expect(values).toEqual([2, 2])
    expect(spy).toHaveBeenCalledTimes(2)
    expect(isComputedPropMobX(counter, "doubled")).toEqual(false)
    spy.mockRestore()
    expect(counter.doubled).toEqual(2)
  })

  it("honors a prototype spy installed after another instance materialized", () => {
    const materialized = new Counter()
    expect(materialized.doubled).toEqual(2)
    const spy = jest.spyOn(Counter.prototype, "doubled", "get")
    const fresh = new Counter()

    const values = [fresh.doubled, fresh.doubled]

    expect(values).toEqual([2, 2])
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })

  it("applies the comparer of @ga.computed.equals", () => {
    @ga.observableClass
    class Parity extends Destructible {
      num = 1

      @ga.computed.equals(comparer.shallow)
      get evenness(): { even: boolean } {
        return { even: this.num % 2 === 0 }
      }
    }
    const parity = new Parity()
    const fn = jest.fn()
    const dispose = autorun(() => fn(parity.evenness))

    runInAction(() => {
      parity.num = 3
    })
    runInAction(() => {
      parity.num = 4
    })

    expect(fn.mock.calls).toEqual([[{ even: false }], [{ even: true }]])
    dispose()
  })

  it("leaves @ga.computed.exceptInTestsToBeSpyable plain in tests", () => {
    @ga.observableClass
    class Spyable extends Destructible {
      num = 1

      @ga.computed.exceptInTestsToBeSpyable
      get doubled(): number {
        evaluations.push("doubled")
        return this.num * 2
      }
    }
    const spyable = new Spyable()

    const values = [spyable.doubled, spyable.doubled]

    expect(values).toEqual([2, 2])
    expect(Object.hasOwn(spyable, "doubled")).toEqual(false)
    expect(evaluations).toEqual(["doubled", "doubled"])
  })
})
