import { VoidFunction } from "../../helpers"
import { ga } from "../decorators"

const staticBlockRuns: string[] = []

@ga.observableClass
class DecoratedWithStaticBlock {
  static {
    staticBlockRuns.push("ran")
  }

  someField = 1
  otherField = "x"
  private destructors: VoidFunction[] = []

  addDestructor(destructor: VoidFunction) {
    this.destructors.push(destructor)
  }
}

it("runs a static block in a decorated class with instance fields once per class", () => {
  // @swc/core < 1.15.36 folded the static block into the first instance field's initializer
  // under decoratorVersion 2022-03, so it ran once per construction instead of once per class.
  // This executes through @swc/jest, so it guards the actual transform we ship with.
  expect(staticBlockRuns).toEqual(["ran"])

  const first = new DecoratedWithStaticBlock()
  const second = new DecoratedWithStaticBlock()

  expect(staticBlockRuns).toEqual(["ran"])
  expect(first.someField).toEqual(1)
  expect(second.otherField).toEqual("x")
})
