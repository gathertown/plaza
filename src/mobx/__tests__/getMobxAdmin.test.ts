import { makeAutoObservable } from "mobx"

import { getMobxAdmin } from "../getMobxAdmin"

describe(".values_", () => {
  it("contains property names of observables and computeds", () => {
    class Test {
      i = 0
      constructor() {
        makeAutoObservable(this)
      }
      get foo() {
        return this.i
      }
    }

    const instance = new Test()
    expect(getMobxAdmin(instance).values_.has("i")).toEqual(true)
    expect(getMobxAdmin(instance).values_.has("foo")).toEqual(true)
  })
})
