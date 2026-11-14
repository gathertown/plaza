import { expectTypeOf } from "expect-type"

import { createErrorClass, guaranteedError, suppressError, suppressSyncError } from "../errors"

describe("#createErrorClass", () => {
  it("provides basic error class generation", () => {
    const MyError = createErrorClass("MyError")
    const error = new MyError("foobar")

    expect(error.name).toEqual("MyError")
    expect(error.message).toEqual("foobar")
    expect(error instanceof MyError).toEqual(true)
  })

  it("has a default message option with a plain string", () => {
    const MyError = createErrorClass("MyError", { defaultMessage: "my default message" })
    const error = new MyError()
    expect(error.message).toEqual("my default message")
  })

  it("allows metadata to be provided", () => {
    const MyError = createErrorClass<{ foo: string }>("MyError")
    const error = new MyError("foobar", { foo: "foo" })
    expect(error.metadata.foo).toEqual("foo")
    expectTypeOf(error.metadata).toMatchTypeOf<{ foo: string }>()
    // @ts-expect-error -- missing metadata
    new MyError("foobar")
    // @ts-expect-error -- wrong metadata type
    new MyError("foobar", { foo: 2 })
  })

  describe("default message with metadata option", () => {
    it("has metadata provided to default message function", () => {
      const MyError = createErrorClass<{ foo: string }>("MyError", {
        defaultMessage: (metadata) => `Default message with metadata ${metadata.foo}`,
      })
      const error = new MyError(undefined, { foo: "foo" })
      expect(error.message).toEqual("Default message with metadata foo")
    })

    it("has no metadata on default message fn when metadata type isn't provided", () => {
      createErrorClass("MyError", {
        defaultMessage: (metadata) => {
          expectTypeOf(metadata).toMatchTypeOf<undefined>()
          return "message"
        },
      })
    })
  })
})

describe("suppressError", () => {
  it("returns the result of the promise when it resolves", async () => {
    const result = await suppressError(async () => 42)
    expect(result).toEqual(42)
  })

  it("returns undefined when the promise rejects", async () => {
    const result = await suppressError(async () => {
      throw new Error("Async error")
    })
    expect(result).toEqual(undefined)
  })

  it("calls the logger function when the promise rejects", async () => {
    const loggerFn = jest.fn()
    const error = new Error("Async error for logger")
    await suppressError(async () => {
      throw error
    }, loggerFn)
    expect(loggerFn).toHaveBeenCalledTimes(1)
    expect(loggerFn).toHaveBeenCalledWith(error)
  })

  it("does not call the logger function when the promise resolves", async () => {
    const loggerFn = jest.fn()
    await suppressError(async () => 42, loggerFn)
    expect(loggerFn).not.toHaveBeenCalled()
  })

  it("returns undefined and does not throw if loggerFn is not provided and the promise rejects", async () => {
    const result = await suppressError(async () => {
      throw new Error("Async error without logger")
    })
    expect(result).toEqual(undefined)
  })
})

describe("suppressSyncError", () => {
  it("returns the result of the function when no error occurs", () => {
    const result = suppressSyncError(() => 42)
    expect(result).toEqual(42)
  })

  it("returns undefined when the function throws an error", () => {
    const result = suppressSyncError(() => {
      throw new Error("Sync error")
    })
    expect(result).toEqual(undefined)
  })

  it("calls the logger function when an error occurs", () => {
    const loggerFn = jest.fn()
    const error = new Error("Sync error for logger")
    suppressSyncError(() => {
      throw error
    }, loggerFn)
    expect(loggerFn).toHaveBeenCalledTimes(1)
    expect(loggerFn).toHaveBeenCalledWith(error)
  })

  it("does not call the logger function when no error occurs", () => {
    const loggerFn = jest.fn()
    suppressSyncError(() => 42, loggerFn)
    expect(loggerFn).not.toHaveBeenCalled()
  })

  it("does not call the logger function if not provided and an error occurs", () => {
    expect(() =>
      suppressSyncError(() => {
        throw new Error("Sync error without logger")
      }),
    ).not.toThrow()
  })
})

/* eslint-disable jest/no-conditional-expect -- deliberately testing inside a try/catch */
describe("#guaranteedError", () => {
  it("runs the error when it's given an Error", () => {
    try {
      // noinspection ExceptionCaughtLocallyJS
      throw new Error("test")
    } catch (err) {
      const e: Error = guaranteedError(err)
      expect(e).toBe(err)
      expectTypeOf(e).toMatchTypeOf<Error>()
    }
  })

  it("reports a bad error when something other than an Error is thrown", () => {
    jest.spyOn(console, "error").mockImplementation(() => {})
    try {
      // DO NOT pattern off throwing a non-error, you should always `throw new Error(...)`
      // This is for testing purposes only.
      // noinspection ExceptionCaughtLocallyJS
      throw "should not throw this way"
    } catch (err) {
      const e = guaranteedError(err)
      expect(e).toEqual(new Error("Thrown error was not an instance of Error"))
      expect(console.error).toHaveBeenCalledWith(
        expect.stringMatching(`Caught error not instanceof Error.

  Original error: should not throw this way

  Stacktrace:

Error: Thrown error was not an instance of Error
    at`),
      )
    }
  })
})
/* eslint-enable jest/no-conditional-expect */
