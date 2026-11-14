import { Destructible } from "../Destructible"

describe("#Destructible", () => {
  it("resetDestroyed() re-enables destroy()", () => {
    class TestDestructible extends Destructible {
      get destroyed() {
        return this.isDestroyed
      }
      reset() {
        this.resetDestroyed()
      }
    }

    const d = new TestDestructible()
    const firstDestructor = jest.fn()
    const secondDestructor = jest.fn()

    d.addDestructor(firstDestructor)
    d.destroy()

    expect(firstDestructor).toHaveBeenCalledOnce()
    expect(d.destroyed).toEqual(true)

    d.reset()

    expect(d.destroyed).toEqual(false)

    d.addDestructor(secondDestructor)
    d.destroy()

    expect(secondDestructor).toHaveBeenCalledOnce()
    expect(firstDestructor).toHaveBeenCalledOnce()
  })

  it("runs all destructors once in .destroy()", () => {
    const d = new Destructible()

    const f1 = jest.fn()
    const f2 = jest.fn()
    const f3 = jest.fn()
    d.addDestructor(f1)
    d.addDestructors(f2, f3)

    d.destroy()
    d.destroy()
    ;[f1, f2, f3].forEach((f) => expect(f).toHaveBeenCalledOnce())
  })

  it("always runs `destroy()` with the correct `this`", () => {
    const d = new Destructible()
    const { destroy } = d

    const mockDestructor = jest.fn()
    d.addDestructor(mockDestructor)

    destroy()

    expect(mockDestructor).toHaveBeenCalledOnce()
  })

  it("runs all destructors even when one throws", () => {
    const d = new Destructible()

    const f1 = jest.fn()
    const f2 = jest.fn(() => {
      throw new Error("boom")
    })
    const f3 = jest.fn()
    d.addDestructors(f1, f2, f3)

    expect(() => d.destroy()).toThrow("boom")

    expect(f1).toHaveBeenCalledOnce()
    expect(f2).toHaveBeenCalledOnce()
    expect(f3).toHaveBeenCalledOnce()
  })

  it("throws AggregateError when multiple destructors throw", () => {
    const d = new Destructible()

    const f1 = jest.fn(() => {
      throw new Error("first")
    })
    const f2 = jest.fn()
    const f3 = jest.fn(() => {
      throw new Error("second")
    })
    d.addDestructors(f1, f2, f3)

    expect(() => d.destroy()).toThrow("Multiple destructors threw during destroy()")

    expect(f1).toHaveBeenCalledOnce()
    expect(f2).toHaveBeenCalledOnce()
    expect(f3).toHaveBeenCalledOnce()
  })

  it("does not re-run destructors after throwing destroy + resetDestroyed", () => {
    class TestDestructible extends Destructible {
      reset() {
        this.resetDestroyed()
      }
    }

    const d = new TestDestructible()
    const throwingDestructor = jest.fn(() => {
      throw new Error("boom")
    })
    d.addDestructor(throwingDestructor)

    expect(() => d.destroy()).toThrow("boom")

    d.reset()

    const newDestructor = jest.fn()
    d.addDestructor(newDestructor)
    d.destroy()

    expect(throwingDestructor).toHaveBeenCalledOnce()
    expect(newDestructor).toHaveBeenCalledOnce()
  })

  it("shows isDestroyed after destruction", () => {
    class Test extends Destructible {
      get destroyed() {
        return this.isDestroyed
      }
    }
    const d = new Test()

    expect(d.destroyed).toEqual(false)

    const mockDestructor = jest.fn()
    d.addDestructor(mockDestructor)

    expect(d.destroyed).toEqual(false)

    d.destroy()

    expect(mockDestructor).toHaveBeenCalledOnce()
    expect(d.destroyed).toEqual(true)
  })
})
