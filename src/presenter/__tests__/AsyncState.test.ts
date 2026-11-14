/* eslint-disable jest/no-conditional-expect */

import { expectTypeOf } from "expect-type"

import { deferredPromise, fireAndForget } from "../../helpers"
import { Destructible } from "../../mobx"
import { flushPromises, setUpErrorSilencing, silenceLoggerErrors } from "../../testing"
import { AsyncState } from "../AsyncState"
import { AsyncStatus } from "../asyncStateShared"

setUpErrorSilencing()

class RestartableDestructible extends Destructible {
  restart() {
    this.resetDestroyed()
  }
}

describe("#AsyncState", () => {
  let owner: Destructible

  beforeEach(() => {
    owner = new Destructible()
  })

  it("loads a promised function", async () => {
    const fakePromise = deferredPromise<string>()
    const asyncState = new AsyncState(owner, () => fakePromise.promise)

    const loadPromise = asyncState.load(undefined)

    fakePromise.resolve("data")
    await loadPromise

    expect(asyncState.data).toEqual("data")
    expect(asyncState.status).toEqual(AsyncStatus.Success)
  })

  it("handles an error in the promise and sets the correct status", async () => {
    silenceLoggerErrors("AsyncState load failed")
    const fakePromise = deferredPromise<string>()
    const asyncState = new AsyncState(owner, () => fakePromise.promise)

    const loadPromise = asyncState.load(undefined)

    fakePromise.reject(new Error("error message"))
    await loadPromise

    expect(asyncState.error).toEqual("error message")
    expect(asyncState.status).toEqual(AsyncStatus.Error)
  })

  it("routes a load function that throws before returning a promise through the error path", async () => {
    silenceLoggerErrors("AsyncState load failed")
    const asyncState = new AsyncState<string>(owner, () => {
      throw new Error("sync failure")
    })

    await asyncState.load()

    expect(asyncState.status).toEqual(AsyncStatus.Error)
    expect(asyncState.error).toEqual("sync failure")
    expect(asyncState.isFetching()).toEqual(false)
  })

  it("handles a request that fails after an onLoad handler threw", async () => {
    silenceLoggerErrors("AsyncState load failed")
    const unhandled: unknown[] = []
    // An event listener, not a mock — the global mock reset does not cover it.
    const recordUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on("unhandledRejection", recordUnhandled)
    const request = deferredPromise<string>()
    const asyncState = new AsyncState(owner, () => request.promise, {
      onLoad: () => {
        throw new Error("handler failure")
      },
    })

    await asyncState.load(undefined)
    request.reject(new Error("request failure"))
    // A macrotask, because node only reports an unhandled rejection once the microtasks drain.
    await new Promise((resolve) => setTimeout(resolve, 0))
    process.off("unhandledRejection", recordUnhandled)

    expect(unhandled).toEqual([])
    expect(asyncState.error).toEqual("handler failure")
  })

  it("has a pending state before loading has started", async () => {
    const fakePromise = deferredPromise<string>()
    const asyncState = new AsyncState(owner, () => fakePromise.promise)

    expect(asyncState.status).toEqual(AsyncStatus.Pending)
  })

  it("has a loading state when data starts loading", async () => {
    const fakePromise = deferredPromise<string>()
    const asyncState = new AsyncState(owner, () => fakePromise.promise)

    const loadPromise = asyncState.load(undefined)

    // The load function waits for the existing promise (which immediately resolves), so we need to
    // wait for the next tick for loading state to change.
    await new Promise(process.nextTick)

    expect(asyncState.isFetching()).toEqual(true)
    expect(asyncState.isFetching()).toEqual(true)

    fakePromise.resolve("data")
    await loadPromise
  })

  it("allows the load function to take in parameters", async () => {
    const asyncState = new AsyncState(owner, (args?: { foo: string }) => Promise.resolve(args?.foo))

    await asyncState.load({ foo: "bar" })
    expect(asyncState.data).toEqual("bar")
  })

  it("allows a load function with parameters to be called with undefined parameters", async () => {
    const asyncState = new AsyncState(owner, (args?: { foo: string }) => Promise.resolve(args?.foo))

    await asyncState.load(undefined)
    expect(asyncState.data).toEqual(undefined)
  })

  it("correctly narrows down state through type predicates", () => {
    const fakePromise = deferredPromise<string>()
    const asyncState = new AsyncState(owner, () => fakePromise.promise)

    if (asyncState.isPending()) {
      expectTypeOf(asyncState.data).toMatchTypeOf<undefined>()
    }

    if (asyncState.isRefetching()) {
      expectTypeOf(asyncState.data).toMatchTypeOf<string>()
    }

    if (asyncState.isSuccess()) {
      expectTypeOf(asyncState.data).toMatchTypeOf<string>()
    }

    if (asyncState.isError()) {
      expectTypeOf(asyncState.error).toMatchTypeOf<string>()
    }
  })

  it("correctly narrows down state from status helper functions", () => {
    const fakePromise = deferredPromise<string>()
    const asyncState = new AsyncState(owner, () => fakePromise.promise)

    if (asyncState.isSuccess()) {
      expectTypeOf(asyncState.data).toMatchTypeOf<string>()
    }

    if (asyncState.hasData()) {
      expectTypeOf(asyncState.data).toMatchTypeOf<string | undefined>()
    }

    if (asyncState.isError()) {
      expectTypeOf(asyncState.error).toMatchTypeOf<string>()
    }
  })

  describe("#load", () => {
    it("'cancels' existing promises so that their data isn't loaded", async () => {
      const fakePromise = {
        long: deferredPromise<string>(),
        short: deferredPromise<string>(),
      } as const
      const asyncState = new AsyncState(
        owner,
        (params?: { length: "long" | "short" }) => fakePromise[params?.length ?? "short"].promise,
      )

      const loadPromiseOne = asyncState.load({ length: "long" })
      const loadPromiseTwo = asyncState.load({ length: "short" })

      // Simulate "short" loading faster than "long"
      fakePromise.short.resolve("short")
      fakePromise.long.resolve("long")

      await Promise.all([loadPromiseOne, loadPromiseTwo])

      // Since "short" load was called after "long", even though long resolved later, the "short"
      // value should be the value that is used.
      expect(asyncState.data).toEqual("short")
    })
  })

  describe("cancellation", () => {
    it("does not set error state when a canceled load errors", async () => {
      const promise1 = deferredPromise<string>()
      const promise2 = deferredPromise<string>()
      const asyncState = new AsyncState(
        owner,
        jest.fn().mockReturnValueOnce(promise1.promise).mockReturnValueOnce(promise2.promise),
      )

      const load1 = asyncState.load()
      const load2 = asyncState.load()

      promise1.reject(new Error("old error"))
      await load1

      expect(asyncState.isFetching()).toEqual(true)
      expect(asyncState.isError()).toEqual(false)

      promise2.resolve("fresh data")
      await load2

      expect(asyncState.data).toEqual("fresh data")
      expect(asyncState.status).toEqual(AsyncStatus.Success)
    })

    it("reports a load that was retired before it answered as canceled", async () => {
      const request = deferredPromise<string>()
      const asyncState = new AsyncState(owner, () => request.promise)
      const load = asyncState.load()

      asyncState.reset()
      request.resolve("stale")
      await load

      expect(asyncState.wasCanceled()).toEqual(true)
    })

    it("does not report a load that answered as canceled", async () => {
      const asyncState = new AsyncState(owner, async () => "data")

      await asyncState.load()

      expect(asyncState.wasCanceled()).toEqual(false)
    })
  })

  describe("#reset", () => {
    it("'cancels' the existing promise", async () => {
      const fakePromise = deferredPromise<string>()
      const asyncState = new AsyncState(owner, () => fakePromise.promise)

      const loadPromise = asyncState.load(undefined)

      asyncState.reset()

      fakePromise.resolve("data")
      await loadPromise

      expect(asyncState.data).toEqual(undefined)
      expect(asyncState.status).toEqual(AsyncStatus.Pending)
    })

    it("stays reset when a request answered just before the reset", async () => {
      const request = deferredPromise<string>()
      const asyncState = new AsyncState(owner, () => request.promise)
      const load = asyncState.load(undefined)

      // The request wins the race, so the retirement is not what the load reads back.
      request.resolve("stale")
      asyncState.reset()
      await load

      expect(asyncState.data).toEqual(undefined)
      expect(asyncState.status).toEqual(AsyncStatus.Pending)
      expect(asyncState.isFetching()).toEqual(false)
    })
  })

  describe("#destroy", () => {
    it("cancels the running load", async () => {
      const request = deferredPromise<string>()
      const asyncState = new AsyncState(owner, () => request.promise)
      const load = asyncState.load()

      asyncState.destroy()
      request.resolve("stale")
      await load

      expect(asyncState.wasCanceled()).toEqual(true)
      expect(asyncState.isFetching()).toEqual(false)
    })

    it("starts no load once destroyed", async () => {
      const loadFn = jest.fn(async () => "data")
      const asyncState = new AsyncState(owner, loadFn)
      asyncState.destroy()

      await asyncState.load()

      expect(loadFn).not.toHaveBeenCalled()
      expect(asyncState.isFetching()).toEqual(false)
    })
  })

  describe("when its owner is destroyed", () => {
    it("starts no load", async () => {
      const loadFn = jest.fn(async () => "data")
      const asyncState = new AsyncState(owner, loadFn)
      owner.destroy()

      await asyncState.load()

      expect(loadFn).not.toHaveBeenCalled()
    })

    it("drops an answer that arrives after the destroy", async () => {
      const onSuccess = jest.fn()
      const request = deferredPromise<string>()
      const asyncState = new AsyncState(owner, () => request.promise, { onSuccess })
      const load = asyncState.load()

      owner.destroy()
      request.resolve("stale")
      await load

      expect(asyncState.data).toEqual(undefined)
      expect(onSuccess).not.toHaveBeenCalled()
    })

    it("records no error for a request that fails after the destroy", async () => {
      const request = deferredPromise<string>()
      const asyncState = new AsyncState(owner, () => request.promise)
      const load = asyncState.load()

      owner.destroy()
      request.reject(new Error("timed out"))
      await load

      expect(asyncState.isError()).toEqual(false)
    })

    it("loads again once the owner is started again", async () => {
      const restartableOwner = new RestartableDestructible()
      const asyncState = new AsyncState(restartableOwner, async () => "data")
      restartableOwner.destroy()
      restartableOwner.restart()

      await asyncState.load()

      expect(asyncState.data).toEqual("data")
    })
  })

  describe("#awaitLoad", () => {
    const fakeLoadFn = jest.fn((param?: string) => Promise.resolve(param ?? "data"))

    it("does nothing if awaitLoad is called when nothing is loading", async () => {
      const asyncState = new AsyncState(owner, fakeLoadFn)

      await asyncState.awaitLoad()

      expect(asyncState.status).toEqual(AsyncStatus.Pending)
      expect(fakeLoadFn).toHaveBeenCalledTimes(0)
    })

    it("waits for in-progress load to complete", async () => {
      const fakePromise = deferredPromise<string>()
      const asyncState = new AsyncState(owner, () => fakePromise.promise)

      const loadPromise = asyncState.load(undefined)
      // Wait for next tick to ensure loading state is set
      await new Promise(process.nextTick)

      expect(asyncState.isFetching()).toEqual(true)

      const awaitPromise = asyncState.awaitLoad()
      fakePromise.resolve("data")

      await awaitPromise
      await loadPromise

      expect(asyncState.status).toEqual(AsyncStatus.Success)
      expect(asyncState.data).toEqual("data")
    })

    it("does nothing if awaitLoad is called when load is already successful", async () => {
      const asyncState = new AsyncState(owner, fakeLoadFn)

      await asyncState.load(undefined)
      await asyncState.awaitLoad()

      expect(asyncState.status).toEqual(AsyncStatus.Success)
      expect(asyncState.data).toEqual("data")
      expect(fakeLoadFn).toHaveBeenCalledTimes(1)
    })
  })

  describe("#ensureLoaded", () => {
    const fakeLoadFn = jest.fn((param?: string) => Promise.resolve(param ?? "data"))

    it("loads with provided params if not already successful", async () => {
      const asyncState = new AsyncState(owner, fakeLoadFn)

      await asyncState.ensureLoaded("test-param")

      expect(asyncState.status).toEqual(AsyncStatus.Success)
      expect(asyncState.data).toEqual("test-param")
      expect(fakeLoadFn).toHaveBeenCalledWith("test-param")
      expect(fakeLoadFn).toHaveBeenCalledTimes(1)
    })

    it("does nothing if already successful", async () => {
      const asyncState = new AsyncState(owner, fakeLoadFn)

      await asyncState.load("initial")
      await asyncState.ensureLoaded("different-param")

      expect(asyncState.status).toEqual(AsyncStatus.Success)
      expect(asyncState.data).toEqual("initial")
      expect(fakeLoadFn).toHaveBeenCalledTimes(1)
    })

    it("loads with new params if current state is error", async () => {
      silenceLoggerErrors("AsyncState load failed")

      const failingLoadFn = jest
        .fn()
        .mockRejectedValueOnce(new Error("Load failed"))
        .mockResolvedValueOnce("success")

      const asyncState = new AsyncState(owner, failingLoadFn)

      // First load fails
      await asyncState.load("first-param")
      expect(asyncState.status).toEqual(AsyncStatus.Error)

      // ensureLoaded should load with new params since current state is error
      await asyncState.ensureLoaded("second-param")

      expect(asyncState.status).toEqual(AsyncStatus.Success)
      expect(asyncState.data).toEqual("success")
      expect(failingLoadFn).toHaveBeenCalledWith("first-param")
      expect(failingLoadFn).toHaveBeenCalledWith("second-param")
      expect(failingLoadFn).toHaveBeenCalledTimes(2)
    })

    it("shares one load between callers that arrive in the same tick", async () => {
      const asyncState = new AsyncState(owner, fakeLoadFn)

      await Promise.all([
        asyncState.ensureLoaded("param"),
        asyncState.ensureLoaded("param"),
        asyncState.ensureLoaded("param"),
      ])

      expect(fakeLoadFn).toHaveBeenCalledTimes(1)
    })

    it("settles callers that joined a load which then failed, without retrying", async () => {
      silenceLoggerErrors("AsyncState load failed")
      const failing = deferredPromise<string>()
      const failingLoadFn = jest.fn(() => failing.promise)
      const asyncState = new AsyncState(owner, failingLoadFn)
      const started = asyncState.ensureLoaded(undefined)
      const joined = asyncState.ensureLoaded(undefined)

      failing.reject(new Error("Load failed"))
      await Promise.all([started, joined])

      expect(asyncState.status).toEqual(AsyncStatus.Error)
      expect(failingLoadFn).toHaveBeenCalledTimes(1)
    })

    it("lets an explicit load supersede the load a joiner is waiting on", async () => {
      const stale = deferredPromise<string>()
      const fresh = deferredPromise<string>()
      const asyncState = new AsyncState(
        owner,
        jest.fn().mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise),
      )
      const started = asyncState.ensureLoaded(undefined)
      const joined = asyncState.ensureLoaded(undefined)
      const replaced = asyncState.load(undefined)

      stale.resolve("stale")
      fresh.resolve("fresh")
      await Promise.all([started, joined, replaced])

      expect(asyncState.data).toEqual("fresh")
    })
  })

  describe("reentrant handlers", () => {
    it("lets an onLoad handler await the load it is being told about", async () => {
      const slow = deferredPromise<string>()
      let joined = false
      const asyncState: AsyncState<string> = new AsyncState(owner, () => slow.promise, {
        onLoad: () => {
          fireAndForget(
            asyncState.awaitLoad().then(() => {
              joined = true
            }),
            "test joiner failed",
          )
        },
      })

      const load = asyncState.load()
      await flushPromises()

      expect(joined).toEqual(false)

      slow.resolve("loaded")
      await load
      await flushPromises()

      expect(joined).toEqual(true)
    })
  })

  describe("#seed", () => {
    it("keeps the seeded data over a load that settles afterwards", async () => {
      const slow = deferredPromise<string>()
      const asyncState = new AsyncState(owner, () => slow.promise)
      const load = asyncState.load(undefined)

      asyncState.seed("seeded")
      slow.resolve("stale")
      await load

      expect(asyncState.data).toEqual("seeded")
      expect(asyncState.isFetching()).toEqual(false)
    })

    it("keeps the seeded data over a request that answered just before the seed", async () => {
      const request = deferredPromise<string>()
      const asyncState = new AsyncState(owner, () => request.promise)
      const load = asyncState.load(undefined)

      // The request wins the race, so the retirement is not what the load reads back.
      request.resolve("stale")
      asyncState.seed("seeded")
      await load

      expect(asyncState.data).toEqual("seeded")
      expect(asyncState.status).toEqual(AsyncStatus.Success)
    })

    it("keeps a joiner waiting when a replacement load takes over", async () => {
      const first = deferredPromise<string>()
      const second = deferredPromise<string>()
      let calls = 0
      const asyncState = new AsyncState(owner, () => {
        calls += 1
        return calls === 1 ? first.promise : second.promise
      })
      fireAndForget(asyncState.load(undefined), "test load failed")
      let joinerReturned = false
      const joined = asyncState.ensureLoaded().then(() => {
        joinerReturned = true
      })

      fireAndForget(asyncState.load(undefined), "test reload failed")
      await flushPromises()

      expect(joinerReturned).toEqual(false)

      second.resolve("second")
      await joined

      expect(asyncState.data).toEqual("second")
    })

    it("releases a joiner waiting on the load it supersedes", async () => {
      const neverSettles = deferredPromise<string>()
      const asyncState = new AsyncState(owner, () => neverSettles.promise)
      fireAndForget(asyncState.load(undefined), "test load failed")
      const joined = asyncState.ensureLoaded()

      asyncState.seed("seeded")
      await joined

      expect(asyncState.data).toEqual("seeded")
    })

    it("releases a caller waiting on the load it supersedes", async () => {
      const neverSettles = deferredPromise<string>()
      const asyncState = new AsyncState(owner, () => neverSettles.promise)
      const load = asyncState.load(undefined)

      asyncState.seed("seeded")

      expect(await load).toEqual(undefined)
      expect(asyncState.data).toEqual("seeded")
    })
  })

  describe("#isFetchingWithoutData", () => {
    it("returns true while the first load runs", () => {
      const fakePromise = deferredPromise<string>()
      const asyncState = new AsyncState(owner, () => fakePromise.promise)

      asyncState.load(undefined)

      expect(asyncState.isFetchingWithoutData()).toEqual(true)
    })

    it("returns false while a refetch runs over seeded data", () => {
      const fakePromise = deferredPromise<string>()
      const asyncState = new AsyncState(owner, () => fakePromise.promise)
      asyncState.seed("data")

      asyncState.load(undefined)

      expect(asyncState.isFetchingWithoutData()).toEqual(false)
    })
  })

  describe("#isErrorWithoutData", () => {
    it("returns true when the load failed with no data", async () => {
      silenceLoggerErrors("AsyncState load failed")
      const asyncState = new AsyncState<string>(owner, () => Promise.reject(new Error("failed")))

      await asyncState.load()

      expect(asyncState.isErrorWithoutData()).toEqual(true)
    })

    it("returns false when a refetch failed over seeded data", async () => {
      silenceLoggerErrors("AsyncState load failed")
      const asyncState = new AsyncState<string>(owner, () => Promise.reject(new Error("failed")))
      asyncState.seed("data")

      await asyncState.load()

      expect(asyncState.isErrorWithoutData()).toEqual(false)
    })
  })

  describe("#dataOrThrow", () => {
    it("returns if the data is loaded", () => {
      const fakePromise = deferredPromise<string>()
      const asyncState = new AsyncState(owner, () => fakePromise.promise)

      asyncState.seed("data")

      expect(asyncState.dataOrThrow).toEqual("data")
    })

    it("returns if the data is loaded while loading new data", () => {
      const fakePromise = deferredPromise<string>()
      const asyncState = new AsyncState(owner, () => fakePromise.promise)

      asyncState.seed("data")

      asyncState.load(undefined)

      expect(asyncState.isRefetching()).toEqual(true)
      expect(asyncState.dataOrThrow).toEqual("data")
    })

    it("throws if the data has not been loaded", () => {
      const fakePromise = deferredPromise<string>()
      const asyncState = new AsyncState(owner, () => fakePromise.promise)

      expect(() => asyncState.dataOrThrow).toThrow("Data is not loaded")
    })
  })

  describe("conditional params", () => {
    it("allows load() and ensureLoaded() without params when TParams is void", async () => {
      const noParamsLoadFn = jest.fn(() => Promise.resolve("data"))
      const asyncState = new AsyncState(owner, noParamsLoadFn)

      // These should compile without type errors
      await asyncState.load()
      await asyncState.ensureLoaded()

      expect(asyncState.data).toEqual("data")
      expect(noParamsLoadFn).toHaveBeenCalledTimes(1) // ensureLoaded() should be no-op since already successful
    })

    it("requires params when TParams is not void", async () => {
      const withParamsLoadFn = jest.fn((param: string) => Promise.resolve(param))
      const asyncState = new AsyncState(owner, withParamsLoadFn)

      // These require params
      await asyncState.load("test")
      await asyncState.ensureLoaded("test2")

      expect(asyncState.data).toEqual("test")
      expect(withParamsLoadFn).toHaveBeenCalledWith("test")
      expect(withParamsLoadFn).toHaveBeenCalledTimes(1) // ensureLoaded() should be no-op since already successful
    })
  })

  describe("event handlers", () => {
    it("calls onLoad when load starts", async () => {
      const onLoad = jest.fn()
      const fakePromise = deferredPromise<string>()
      const asyncState = new AsyncState(owner, () => fakePromise.promise, { onLoad })

      asyncState.load(undefined)
      expect(onLoad).toHaveBeenCalledWith(undefined)

      fakePromise.resolve("data")
    })

    it("calls handlers when load succeeds", async () => {
      const onSuccess = jest.fn()
      const onSettled = jest.fn()
      const asyncState = new AsyncState(owner, async () => "test data", { onSuccess, onSettled })

      await asyncState.load(undefined)
      expect(onSuccess).toHaveBeenCalledWith("test data", undefined)
      expect(onSettled).toHaveBeenCalledWith(undefined)
    })

    it("calls onError with error message when load fails", async () => {
      silenceLoggerErrors("AsyncState load failed")
      const onError = jest.fn()
      const onSettled = jest.fn()
      const asyncState = new AsyncState(
        owner,
        async () => {
          throw new Error("test error")
        },
        { onError, onSettled },
      )

      await asyncState.load(undefined)
      expect(onError).toHaveBeenCalledWith("test error", undefined)
      expect(onSettled).toHaveBeenCalledWith(undefined)
    })

    it("passes params to all handlers", async () => {
      const onLoad = jest.fn()
      const onSuccess = jest.fn()
      const onSettled = jest.fn()
      const asyncState = new AsyncState(owner, async (params: string) => params, {
        onLoad,
        onSuccess,
        onSettled,
      })

      await asyncState.load("test-param")

      expect(onLoad).toHaveBeenCalledWith("test-param")
      expect(onSuccess).toHaveBeenCalledWith("test-param", "test-param")
      expect(onSettled).toHaveBeenCalledWith("test-param")
    })

    it("does not call handlers for canceled loads", async () => {
      const onSuccess = jest.fn()
      const onSettled = jest.fn()
      const promise1 = deferredPromise<string>()
      const promise2 = deferredPromise<string>()
      let callCount = 0

      const asyncState = new AsyncState(
        owner,
        () => {
          callCount++
          return callCount === 1 ? promise1.promise : promise2.promise
        },
        { onSuccess, onSettled },
      )

      // Start first load
      asyncState.load(undefined)

      // Start second load (cancels first)
      asyncState.load(undefined)

      // Resolve first promise (should be ignored)
      promise1.resolve("first")
      await flushPromises()

      expect(onSuccess).not.toHaveBeenCalled()
      expect(onSettled).not.toHaveBeenCalled()

      // Resolve second promise
      promise2.resolve("second")
      await flushPromises()

      expect(onSuccess).toHaveBeenCalledWith("second", undefined)
      expect(onSettled).toHaveBeenCalledWith(undefined)
    })

    it("calls handlers for multiple consecutive successful loads", async () => {
      const onLoad = jest.fn()
      const onSuccess = jest.fn()
      const onSettled = jest.fn()
      let counter = 0

      const asyncState = new AsyncState(
        owner,
        async () => {
          counter++
          return `data-${counter}`
        },
        { onLoad, onSuccess, onSettled },
      )

      // First load
      await asyncState.load(undefined)
      expect(onLoad).toHaveBeenCalledTimes(1)
      expect(onSuccess).toHaveBeenCalledTimes(1)
      expect(onSuccess).toHaveBeenCalledWith("data-1", undefined)
      expect(onSettled).toHaveBeenCalledTimes(1)

      // Second load
      await asyncState.load(undefined)
      expect(onLoad).toHaveBeenCalledTimes(2)
      expect(onSuccess).toHaveBeenCalledTimes(2)
      expect(onSuccess).toHaveBeenLastCalledWith("data-2", undefined)
      expect(onSettled).toHaveBeenCalledTimes(2)
    })

    it("does not call handlers after reset", async () => {
      const onSuccess = jest.fn()
      const onSettled = jest.fn()
      const promise = deferredPromise<string>()

      const asyncState = new AsyncState(owner, () => promise.promise, { onSuccess, onSettled })

      // Start load
      asyncState.load(undefined)

      // Reset before promise resolves
      asyncState.reset()

      // Resolve promise after reset
      promise.resolve("data")
      await promise.promise

      // Handlers should not have been called
      expect(onSuccess).not.toHaveBeenCalled()
      expect(onSettled).not.toHaveBeenCalled()
    })

    it("calls handlers in correct order", async () => {
      const callOrder: string[] = []
      const onLoad = jest.fn(() => callOrder.push("onLoad"))
      const onSuccess = jest.fn(() => callOrder.push("onSuccess"))
      const onSettled = jest.fn(() => callOrder.push("onSettled"))

      const asyncState = new AsyncState(owner, async () => "data", { onLoad, onSuccess, onSettled })

      await asyncState.load(undefined)

      expect(callOrder).toEqual(["onLoad", "onSuccess", "onSettled"])
    })
  })

  describe("error telemetry context", () => {
    it("logs the error on load failure", async () => {
      silenceLoggerErrors("AsyncState load failed")

      const asyncState = new AsyncState(owner, () => Promise.reject(new Error("generic failure")))

      await asyncState.load()

      expect(console.error).toHaveBeenCalledWith("AsyncState load failed", expect.any(Error), {})
    })

    it("includes the label as an attribute when provided", async () => {
      silenceLoggerErrors("AsyncState load failed")

      const asyncState = new AsyncState(owner, () => Promise.reject(new Error("some failure")), {
        label: "userProfile",
      })

      await asyncState.load()

      expect(console.error).toHaveBeenCalledWith("AsyncState load failed", expect.any(Error), {
        asyncStateLabel: "userProfile",
      })
    })
  })

  describe("when the load rejects with a canceled request", () => {
    it("settles a CanceledError as canceled", async () => {
      const state = new AsyncState(owner, () =>
        Promise.reject(Object.assign(new Error("canceled"), { name: "CanceledError" })),
      )

      await state.load()

      expect(state.wasCanceled()).toEqual(true)
    })

    it("fails a load that rejects with an AbortError", async () => {
      silenceLoggerErrors("AsyncState load failed")
      const state = new AsyncState(owner, () =>
        Promise.reject(new DOMException("Aborted", "AbortError")),
      )

      await state.load()

      expect(state.isError()).toEqual(true)
    })
  })
})
