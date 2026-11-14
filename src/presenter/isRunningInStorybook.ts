// Bundlers don't add a `process` shim, so this code needs to not crash in that context.
export const isRunningInStorybook = () =>
  typeof process !== "undefined" && Boolean(process.env.STORYBOOK)
