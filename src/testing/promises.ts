// To flush promises when working with non-legacy fake timers in Jest.
// https://gist.github.com/apieceofbart/e6dea8d884d29cf88cdb54ef14ddbcc4
export const flushPromises = () =>
  new Promise(jest.requireActual<typeof import("timers")>("timers").setImmediate)
