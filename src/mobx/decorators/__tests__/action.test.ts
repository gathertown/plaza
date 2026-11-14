import { ga } from ".."

it("disallows action decorators on async methods", () => {
  class _TestClass {
    // @ts-expect-error @ga.action should not be allowed on async methods
    @ga.action
    async testAsync() {}

    // @ts-expect-error @ga.action.bound should not be allowed on async methods
    @ga.action.bound
    async testAsync2() {}
  }
})
