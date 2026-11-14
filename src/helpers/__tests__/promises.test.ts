import { flushPromises, setUpErrorSilencing, silenceLoggerErrors } from "../../testing"
import { fireAndForget } from "../promises"

setUpErrorSilencing()

describe("#fireAndForget", () => {
  it("executes promise without waiting for result", async () => {
    const mockFn = jest.fn().mockResolvedValue("success")
    const promise = Promise.resolve().then(mockFn)

    fireAndForget(promise)

    expect(mockFn).not.toHaveBeenCalled() // Not called yet due to microtask timing
    await flushPromises()
    expect(mockFn).toHaveBeenCalled() // Now it is
  })

  it("can take an anonymous function", async () => {
    const mockFn = jest.fn().mockResolvedValue("success")
    const promise = Promise.resolve().then(mockFn)

    fireAndForget(() => promise)

    expect(mockFn).not.toHaveBeenCalled() // Not called yet due to microtask timing
    await flushPromises()
    expect(mockFn).toHaveBeenCalled() // Now it is
  })

  it("calls custom error handler when promise rejects", async () => {
    const error = new Error("custom error")
    const customErrorHandler = jest.fn()

    fireAndForget(Promise.reject(error), "", customErrorHandler)

    await flushPromises()
    expect(customErrorHandler).toHaveBeenCalledWith(error)
  })

  it("calls custom error handler for async functions that throw", async () => {
    const error = new Error("async throw")
    const customHandler = jest.fn()

    fireAndForget(
      async () => {
        throw error
      },
      "",
      customHandler,
    )

    await flushPromises()
    expect(customHandler).toHaveBeenCalledWith(error)
  })

  it("does not call error handler for successful promises", async () => {
    const customErrorHandler = jest.fn()

    fireAndForget(Promise.resolve("success"), "", customErrorHandler)

    await flushPromises()
    expect(customErrorHandler).not.toHaveBeenCalled()
  })

  it("logs to console.error by default when promise rejects", async () => {
    const error = new Error("default logging test")
    silenceLoggerErrors("[Fire-and-forget promise rejected] default logging test")

    fireAndForget(Promise.reject(error))

    await flushPromises()
  })

  it("logs to console.error by default when async function throws", async () => {
    const error = new Error("async function logging test")
    silenceLoggerErrors("[Fire-and-forget promise rejected] async function logging test")

    fireAndForget(async () => {
      throw error
    })

    await flushPromises()
  })

  it("includes the errorMessage when it logs", async () => {
    const error = new Error("async function logging test")
    silenceLoggerErrors(
      "[Fire-and-forget promise rejected] Failed to execute the function: async function logging test",
    )

    fireAndForget(async () => {
      throw error
    }, "Failed to execute the function")

    await flushPromises()
  })
})
