import { just } from "../../helpers"

// Covers usePresenterOverrides' build-time hook selection, split out of PresenterOverridesContext.test.ts
// on purpose. The selection runs once at module load (isRunningInStorybook() ? ... : ...), so each
// case has to re-import the module under a different environment via jest.isolateModules + doMock. That
// can't share a file with the main suite: the main suite needs a file-level jest.mock forcing
// Storybook = true, and a hoisted jest.mock wins over an in-test doMock, so the app-build case could
// never see false there. Assert against the exported context-reading hook rather than rendering — a
// fresh require pulls in a second React with its own dispatcher, breaking any hook call.
const requireWithDetection = (isStorybook: boolean) => {
  let mod: typeof import("../PresenterOverridesContext") | undefined
  jest.isolateModules(() => {
    jest.doMock("../isRunningInStorybook", () => ({ isRunningInStorybook: () => isStorybook }))
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require("../PresenterOverridesContext")
  })
  return just(mod)
}

it("reads the context in Storybook builds", () => {
  const mod = requireWithDetection(true)

  expect(mod.usePresenterOverrides).toBe(mod.useOverridesFromContext)
})

it("ignores the context in app builds", () => {
  const mod = requireWithDetection(false)

  // The app-build hook reads no context (no React internals), so calling it directly is safe.
  expect(mod.usePresenterOverrides()).toEqual(undefined)
})
