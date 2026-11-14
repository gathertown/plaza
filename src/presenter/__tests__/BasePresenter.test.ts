import { expectTypeOf } from "expect-type"

import { deferredPromise, just } from "../../helpers"
import { autorun, Destructible, ga, runInAction, when } from "../../mobx"
import { setUpErrorSilencing, silenceLoggerErrors, silenceLoggerWarnings } from "../../testing"
import { AsyncState } from "../AsyncState"
import { BasePresenter } from "../BasePresenter"

class FakeAsyncStateProvider extends Destructible {
  deferredPromises = { a: deferredPromise<void>(), b: deferredPromise<void>() }

  private state = {
    demoState: {
      a: new AsyncState(this, async (params?: { foo: string }) => {
        await this.deferredPromises.a.promise
        return params?.foo ?? "loadedA"
      }),
      b: new AsyncState(this, async (params?: { foo: string }) => {
        await this.deferredPromises.b.promise
        return params?.foo ?? "loadedB"
      }),
    },
  }

  getDemoState(state: "a" | "b") {
    return this.state.demoState[state]
  }

  async markStateLoaded(state: "a" | "b") {
    this.deferredPromises[state].resolve()
    await this.deferredPromises[state].promise
  }

  reset() {
    this.state.demoState.a.reset()
    this.state.demoState.b.reset()
    this.deferredPromises.a = deferredPromise<void>()
    this.deferredPromises.b = deferredPromise<void>()
  }
}

const asyncState = new FakeAsyncStateProvider()

setUpErrorSilencing()

describe("#BasePresenter", () => {
  let presenter: Presenter

  beforeEach(() => {
    presenter = new Presenter({ state: "a" })
  })

  afterEach(() => {
    asyncState.reset()
  })

  const deps = (props: Partial<{ state?: "a" | "b" }>) => ({
    asyncStateDep: asyncState.getDemoState(props.state ?? "a"),
  })

  @ga.observableClass
  class Presenter extends BasePresenter<{ state: "a" | "b" }>()(deps) {}

  it("has initial props", () => {
    expect(presenter.props).toEqual({ state: "a" })
  })

  it("extracts async state value from async deps with correct type refinement", async () => {
    const loadPromise = presenter.reloadOnPropChange()

    await asyncState.markStateLoaded("a")
    await loadPromise

    expect(presenter.asyncDeps).toEqual({ asyncStateDep: "loadedA" })
    expectTypeOf(presenter.asyncDeps.asyncStateDep).toEqualTypeOf<string>()
    expectTypeOf(presenter.rawAsyncDeps.asyncStateDep.load).toMatchTypeOf<
      (params: { foo: string } | undefined) => Promise<string | undefined>
    >()
  })

  it("has initial raw deps", () => {
    expect(presenter.rawAsyncDeps).toEqual({ asyncStateDep: asyncState.getDemoState("a") })
  })

  it("updates props when they are changed", () => {
    presenter.syncProps({ state: "b" })

    expect(presenter.props).toEqual({ state: "b" })
  })

  it("initializes with a loading state if the deps have async state", () => {
    expect(presenter.asyncDepsLoaded).toEqual(false)
  })

  it("ensures async state is loaded when reloadOnPropChange is called", async () => {
    const loadPromise = presenter.reloadOnPropChange()

    await asyncState.markStateLoaded("a")
    await loadPromise

    expect(presenter.asyncDepsLoaded).toEqual(true)
    expect(asyncState.getDemoState("a").data).toEqual("loadedA")
  })

  it("calls reloadOnPropChange again with new async dependencies when props are changed", async () => {
    const loadPromise = presenter.reloadOnPropChange()

    await asyncState.markStateLoaded("a")
    await loadPromise

    const syncLoadPromise = presenter.syncProps({ state: "b" })

    expect(presenter.asyncDepsLoaded).toEqual(false)

    await asyncState.markStateLoaded("b")
    await syncLoadPromise
  })

  it("completes loading state after props are changed and async dependencies load", async () => {
    const loadPromise = presenter.reloadOnPropChange()

    await asyncState.markStateLoaded("a")
    await loadPromise

    const syncLoadPromise = presenter.syncProps({ state: "b" })

    await asyncState.markStateLoaded("b")
    await syncLoadPromise

    expect(presenter.asyncDepsLoaded).toEqual(true)
    expect(asyncState.getDemoState("b").data).toEqual("loadedB")
  })

  it("observes changes in updated dependencies when the observable value changes", async () => {
    const loadPromise = presenter.reloadOnPropChange()

    await asyncState.markStateLoaded("a")
    await loadPromise

    const valueChangedPromise = new Promise<void>((resolve) => {
      when(
        () => presenter.asyncDeps.asyncStateDep.includes("new value"),
        () => {
          resolve()
        },
      )
    })

    await asyncState.getDemoState("a").load({ foo: "new value" })

    await valueChangedPromise
  })

  describe("#reaction", () => {
    // Initial sync at construction, then fireImmediately re-evaluates at mount.
    const syncedOnConstructionAndMount = [0, 0]

    @ga.observableClass
    class TestPresenter extends BasePresenter()() {
      count = 0
      effectArgs: number[] = []
      afterMountCalls = 0

      afterObservable() {
        this.reaction(
          () => this.count,
          (val) => {
            this.effectArgs.push(val)
          },
          { fireImmediately: true },
        )
      }

      override afterMount() {
        this.afterMountCalls++
      }
    }

    it("fires the effect synchronously at registration with the initial expression value", () => {
      const presenter = new TestPresenter({})

      expect(presenter.effectArgs).toEqual([0])
    })

    it("fires immediately on mount with the current expression value", () => {
      const presenter = new TestPresenter({})

      presenter.afterMountBase()

      expect(presenter.effectArgs).toEqual(syncedOnConstructionAndMount)
    })

    it("does not subscribe before afterMountBase", () => {
      const presenter = new TestPresenter({})

      runInAction(() => (presenter.count = 1))
      runInAction(() => (presenter.count = 2))

      expect(presenter.effectArgs).toEqual([0])
    })

    it("catches up when observable changes between construction and mounting", () => {
      const presenter = new TestPresenter({})
      runInAction(() => (presenter.count = 1))

      presenter.afterMountBase()

      expect(presenter.effectArgs).toEqual([0, 1])
    })

    it("subscribes after afterMountBase so subsequent mutations call the effect", () => {
      const presenter = new TestPresenter({})
      presenter.afterMountBase()

      runInAction(() => (presenter.count = 1))
      runInAction(() => (presenter.count = 2))

      expect(presenter.effectArgs).toEqual([...syncedOnConstructionAndMount, 1, 2])
    })

    it("stops calling the effect after destroy", () => {
      const presenter = new TestPresenter({})
      presenter.afterMountBase()
      runInAction(() => (presenter.count = 1))

      presenter.destroy()
      runInAction(() => (presenter.count = 2))

      expect(presenter.effectArgs).toEqual([...syncedOnConstructionAndMount, 1])
    })

    it("invokes the user's afterMount when called via afterMountBase", () => {
      const presenter = new TestPresenter({})

      presenter.afterMountBase()

      expect(presenter.afterMountCalls).toEqual(1)
    })

    it("propagates an async afterMount Promise", async () => {
      const afterMountGate = deferredPromise<void>()
      @ga.observableClass
      class AsyncPresenter extends BasePresenter()() {
        override async afterMount() {
          await afterMountGate.promise
        }
      }
      const presenter = new AsyncPresenter({})
      const result = presenter.afterMountBase()

      expect(result).toBeInstanceOf(Promise)

      afterMountGate.resolve()
      await result
    })

    it("does not leak expression reads as deps to an enclosing reactive scope", () => {
      const outerCalls = jest.fn()
      let presenter: TestPresenter | undefined
      const dispose = autorun(
        () => {
          outerCalls()
          if (!presenter) {
            presenter = new TestPresenter({})
          }
        },
        { name: "BasePresenter.test.reaction.outerCalls" },
      )

      runInAction(() => just(presenter).count++)

      expect(outerCalls).toHaveBeenCalledOnce()
      dispose()
    })

    it("does not subscribe at all for an orphan presenter that never reaches afterMountBase", () => {
      @ga.observableClass
      class SharedRepo extends Destructible {
        count = 0
      }
      const repo = new SharedRepo()

      @ga.observableClass
      class OrphanablePresenter extends BasePresenter()() {
        effectArgs: number[] = []
        afterObservable() {
          this.reaction(
            () => repo.count,
            (val) => {
              this.effectArgs.push(val)
            },
            { fireImmediately: true },
          )
        }
      }

      const orphan = new OrphanablePresenter({})
      const committed = new OrphanablePresenter({})
      committed.afterMountBase()

      runInAction(() => (repo.count = 3))

      expect(orphan.effectArgs).toEqual([0])
      expect(committed.effectArgs).toEqual([...syncedOnConstructionAndMount, 3])
    })

    it("passes options through to the underlying reaction", () => {
      silenceLoggerErrors("[MobxReactionError] reaction")
      const errors: unknown[] = []

      @ga.observableClass
      class ErrorPresenter extends BasePresenter()() {
        count = 0
        afterObservable() {
          this.reaction(
            () => this.count,
            (val) => {
              if (val > 0) throw new Error("reaction error")
            },
            { onError: (err: unknown) => errors.push(err), fireImmediately: true },
          )
        }
      }

      const presenter = new ErrorPresenter({})
      presenter.afterMountBase()
      runInAction(() => (presenter.count = 1))

      expect(errors).toEqual([new Error("reaction error")])
    })

    it("does not fire the effect at registration when fireImmediately is not set", () => {
      @ga.observableClass
      class LazyPresenter extends BasePresenter()() {
        count = 0
        effectArgs: number[] = []

        afterObservable() {
          this.reaction(
            () => this.count,
            (val) => {
              this.effectArgs.push(val)
            },
          )
        }
      }

      const presenter = new LazyPresenter({})

      expect(presenter.effectArgs).toEqual([])
    })

    it("does not fire the effect in afterMount when fireImmediately is not set", () => {
      @ga.observableClass
      class LazyPresenter extends BasePresenter()() {
        count = 0
        effectArgs: number[] = []

        afterObservable() {
          this.reaction(
            () => this.count,
            (val) => {
              this.effectArgs.push(val)
            },
          )
        }
      }

      const presenter = new LazyPresenter({})
      expect(presenter.effectArgs).toEqual([])

      presenter.afterMountBase()
      expect(presenter.effectArgs).toEqual([])

      runInAction(() => (presenter.count = 1))
      expect(presenter.effectArgs).toEqual([1])
    })
  })

  describe("#reaction withProps", () => {
    // Initial sync at construction, then runInitialSync re-evaluates at mount.
    const syncedOnConstructionAndMount = [0, 0]

    @ga.observableClass
    class PropTestPresenter extends BasePresenter<{ multiplier: number }>()() {
      effectArgs: number[] = []
      count = 0

      afterObservable() {
        this.reaction(
          () => this.count * this.props.multiplier,
          (val) => {
            this.effectArgs.push(val)
          },
          { withProps: true, fireImmediately: true },
        )
      }
    }

    it("fires the effect synchronously at registration with the initial expression value", () => {
      const presenter = new PropTestPresenter({ multiplier: 2 })

      expect(presenter.effectArgs).toEqual([0])
    })

    it("does not subscribe before afterMountOrPropChangeBase", () => {
      const presenter = new PropTestPresenter({ multiplier: 2 })

      runInAction(() => (presenter.count = 1))

      expect(presenter.effectArgs).toEqual([0])
    })

    it("subscribes after afterMountOrPropChangeBase", async () => {
      const presenter = new PropTestPresenter({ multiplier: 2 })

      await presenter.afterMountOrPropChangeBase()

      runInAction(() => (presenter.count = 3))

      expect(presenter.effectArgs).toEqual([...syncedOnConstructionAndMount, 6])
    })

    it("re-fires the reaction on each afterMountOrPropChangeBase cycle", () => {
      const presenter = new PropTestPresenter({ multiplier: 2 })

      presenter.afterMountOrPropChangeBase()

      // Simulate a prop change: React calls the effect cleanup, then syncProps, then re-mounts.
      presenter.destroyAfterMountOrOnPropChangeDestructors()
      presenter.syncProps({ multiplier: 3 })
      presenter.afterMountOrPropChangeBase()

      expect(presenter.effectArgs).toEqual([...syncedOnConstructionAndMount, 0])
    })

    it("re-fires the reaction with updated prop values on each afterMountOrPropChangeBase cycle", () => {
      const presenter = new PropTestPresenter({ multiplier: 2 })

      presenter.afterMountOrPropChangeBase()

      runInAction(() => (presenter.count = 5))

      presenter.destroyAfterMountOrOnPropChangeDestructors()
      presenter.syncProps({ multiplier: 3 })
      presenter.afterMountOrPropChangeBase()

      expect(presenter.effectArgs).toEqual([...syncedOnConstructionAndMount, 10, 15])
    })

    it("tears down old subscription and re-registers on effect remount", () => {
      const presenter = new PropTestPresenter({ multiplier: 2 })

      presenter.afterMountOrPropChangeBase()
      expect(presenter.effectArgs).toEqual(syncedOnConstructionAndMount)

      runInAction(() => (presenter.count = 1))
      expect(presenter.effectArgs).toEqual([...syncedOnConstructionAndMount, 2])

      presenter.destroyAfterMountOrOnPropChangeDestructors()
      presenter.afterMountOrPropChangeBase()
      expect(presenter.effectArgs).toEqual([...syncedOnConstructionAndMount, 2, 2])

      runInAction(() => (presenter.count = 2))
      expect(presenter.effectArgs).toEqual([...syncedOnConstructionAndMount, 2, 2, 4])
    })

    it("stops firing after destroy", async () => {
      const presenter = new PropTestPresenter({ multiplier: 2 })

      await presenter.afterMountOrPropChangeBase()

      presenter.destroy()

      runInAction(() => (presenter.count = 5))

      expect(presenter.effectArgs).toEqual(syncedOnConstructionAndMount)
    })

    it("catches up on first mount when observable changes between construction and mounting", async () => {
      const presenter = new PropTestPresenter({ multiplier: 2 })
      runInAction(() => (presenter.count = 1))

      await presenter.afterMountOrPropChangeBase()

      expect(presenter.effectArgs).toEqual([0, 2])
    })

    it("does not interfere with mount-only helpers", async () => {
      @ga.observableClass
      class MixedPresenter extends BasePresenter<{ multiplier: number }>()() {
        mountOnlyArgs: number[] = []
        propChangeArgs: number[] = []
        count = 0

        afterObservable() {
          // Mount-only reaction — goes through deferredMountSubscriptions.
          this.reaction(
            () => this.count,
            (val) => {
              this.mountOnlyArgs.push(val)
            },
            { fireImmediately: true },
          )

          // Prop-change reaction — goes through afterMountOrPropChangeBase.
          this.reaction(
            () => this.count * this.props.multiplier,
            (val) => {
              this.propChangeArgs.push(val)
            },
            { withProps: true, fireImmediately: true },
          )
        }
      }

      const presenter = new MixedPresenter({ multiplier: 2 })

      // Only initial syncs fire before any mount.
      expect(presenter.mountOnlyArgs).toEqual([0])
      expect(presenter.propChangeArgs).toEqual([0])

      presenter.afterMountBase()

      runInAction(() => (presenter.count = 3))

      expect(presenter.mountOnlyArgs).toEqual([...syncedOnConstructionAndMount, 3])
      expect(presenter.propChangeArgs).toEqual([0])

      await presenter.afterMountOrPropChangeBase()

      runInAction(() => (presenter.count = 5))

      expect(presenter.mountOnlyArgs).toEqual([...syncedOnConstructionAndMount, 3, 5])
      expect(presenter.propChangeArgs).toEqual([0, 6, 10])
    })

    it("does not subscribe at all for an orphan presenter that never reaches afterMountOrPropChangeBase", async () => {
      @ga.observableClass
      class SharedRepo extends Destructible {
        count = 0
      }
      const repo = new SharedRepo()

      @ga.observableClass
      class OrphanablePresenter extends BasePresenter<{ multiplier: number }>()() {
        effectArgs: number[] = []
        afterObservable() {
          this.reaction(
            () => repo.count,
            (val) => {
              this.effectArgs.push(val)
            },
            { withProps: true, fireImmediately: true },
          )
        }
      }

      const orphan = new OrphanablePresenter({ multiplier: 2 })
      const committed = new OrphanablePresenter({ multiplier: 2 })
      await committed.afterMountOrPropChangeBase()

      runInAction(() => (repo.count = 7))

      expect(orphan.effectArgs).toEqual([0])
      expect(committed.effectArgs).toEqual([...syncedOnConstructionAndMount, 7])
    })
  })

  describe("#autorun withProps", () => {
    @ga.observableClass
    class PropAutorunPresenter extends BasePresenter<{ multiplier: number }>()() {
      viewCalls: number[] = []
      count = 0

      afterObservable() {
        this.autorun(
          () => {
            this.viewCalls.push(this.count * this.props.multiplier)
          },
          { withProps: true },
        )
      }
    }

    it("runs the view synchronously at registration", () => {
      const presenter = new PropAutorunPresenter({ multiplier: 2 })

      expect(presenter.viewCalls).toEqual([0])
    })

    it("re-fires the autorun on each afterMountOrPropChangeBase cycle", () => {
      const presenter = new PropAutorunPresenter({ multiplier: 2 })

      runInAction(() => (presenter.count = 5))

      presenter.afterMountOrPropChangeBase()

      // autorun fires immediately on registration: 5*2=10.
      expect(presenter.viewCalls).toEqual([0, 10])

      presenter.destroyAfterMountOrOnPropChangeDestructors()
      presenter.syncProps({ multiplier: 3 })
      presenter.afterMountOrPropChangeBase()

      // autorun fires on re-registration with updated props: 5*3=15.
      expect(presenter.viewCalls).toEqual([0, 10, 15])
    })

    it("tears down old autorun and re-registers on effect remount", () => {
      const presenter = new PropAutorunPresenter({ multiplier: 2 })

      presenter.afterMountOrPropChangeBase()
      expect(presenter.viewCalls).toEqual([0, 0])

      runInAction(() => (presenter.count = 1))
      expect(presenter.viewCalls).toEqual([0, 0, 2])

      presenter.destroyAfterMountOrOnPropChangeDestructors()
      presenter.afterMountOrPropChangeBase()
      expect(presenter.viewCalls).toEqual([0, 0, 2, 2])

      runInAction(() => (presenter.count = 3))
      expect(presenter.viewCalls).toEqual([0, 0, 2, 2, 6])
    })

    it("stops running the view after destroy", async () => {
      const presenter = new PropAutorunPresenter({ multiplier: 2 })

      await presenter.afterMountOrPropChangeBase()

      presenter.destroy()

      runInAction(() => (presenter.count = 9))

      // Only the initial sync + autorun registration fire; nothing after destroy.
      expect(presenter.viewCalls).toEqual([0, 0])
    })

    it("does not subscribe at all for an orphan presenter that never reaches afterMountOrPropChangeBase", async () => {
      @ga.observableClass
      class SharedRepo extends Destructible {
        count = 0
      }
      const repo = new SharedRepo()

      @ga.observableClass
      class OrphanablePresenter extends BasePresenter<{ multiplier: number }>()() {
        viewCalls: number[] = []
        afterObservable() {
          this.autorun(
            () => {
              this.viewCalls.push(repo.count)
            },
            { withProps: true },
          )
        }
      }

      const orphan = new OrphanablePresenter({ multiplier: 2 })
      const committed = new OrphanablePresenter({ multiplier: 2 })
      await committed.afterMountOrPropChangeBase()

      runInAction(() => (repo.count = 4))

      expect(orphan.viewCalls).toEqual([0])
      expect(committed.viewCalls).toEqual([0, 0, 4])
    })
  })

  describe("#autorun", () => {
    @ga.observableClass
    class TestPresenter extends BasePresenter()() {
      count = 0
      viewCalls: number[] = []

      afterObservable() {
        this.autorun(() => {
          this.viewCalls.push(this.count)
        })
      }
    }

    it("runs the view synchronously at registration with the initial observable values", () => {
      const presenter = new TestPresenter({})

      expect(presenter.viewCalls).toEqual([0])
    })

    it("does not subscribe before afterMountBase", () => {
      const presenter = new TestPresenter({})

      runInAction(() => (presenter.count = 1))

      expect(presenter.viewCalls).toEqual([0])
    })

    it("re-fires the autorun after mount", () => {
      const presenter = new TestPresenter({})

      presenter.afterMountBase()

      expect(presenter.viewCalls).toEqual([0, 0])
    })

    it("subscribes after afterMountBase so observable changes re-run the view", () => {
      const presenter = new TestPresenter({})
      presenter.afterMountBase()

      runInAction(() => (presenter.count = 1))
      runInAction(() => (presenter.count = 2))

      expect(presenter.viewCalls).toEqual([0, 0, 1, 2])
    })

    it("stops re-running the view after destroy", () => {
      const presenter = new TestPresenter({})
      presenter.afterMountBase()

      presenter.destroy()
      runInAction(() => (presenter.count = 9))

      expect(presenter.viewCalls).toEqual([0, 0])
    })

    it("does not leak view reads as deps to an enclosing reactive scope", () => {
      const outerCalls = jest.fn()
      let presenter: TestPresenter | undefined
      const dispose = autorun(
        () => {
          outerCalls()
          if (!presenter) {
            presenter = new TestPresenter({})
          }
        },
        { name: "BasePresenter.test.outerCalls" },
      )

      runInAction(() => just(presenter).count++)
      just(presenter).afterMountBase()

      expect(outerCalls).toHaveBeenCalledOnce()
      dispose()
    })

    it("passes options through to the underlying autorun", () => {
      silenceLoggerErrors("[MobxReactionError] autorun")
      const errors: unknown[] = []

      @ga.observableClass
      class ErrorPresenter extends BasePresenter()() {
        count = 0
        afterObservable() {
          this.autorun(
            () => {
              if (this.count > 0) throw new Error("autorun error")
            },
            { onError: (err) => errors.push(err) },
          )
        }
      }

      const presenter = new ErrorPresenter({})
      presenter.afterMountBase()
      runInAction(() => (presenter.count = 1))

      expect(errors).toEqual([new Error("autorun error")])
    })

    it("does not subscribe at all for an orphan presenter that never reaches afterMountBase", () => {
      @ga.observableClass
      class SharedRepo extends Destructible {
        count = 0
      }
      const repo = new SharedRepo()

      @ga.observableClass
      class OrphanablePresenter extends BasePresenter()() {
        viewCalls: number[] = []
        afterObservable() {
          this.autorun(() => {
            this.viewCalls.push(repo.count)
          })
        }
      }

      const orphan = new OrphanablePresenter({})
      const committed = new OrphanablePresenter({})
      committed.afterMountBase()

      runInAction(() => (repo.count = 5))

      expect(orphan.viewCalls).toEqual([0])
      expect(committed.viewCalls).toEqual([0, 0, 5])
    })
  })

  describe("lifecycle-aware subscription methods", () => {
    describe("afterObservable (constructing path)", () => {
      it("this.reaction({ fireImmediately: true }) seeds state synchronously", () => {
        @ga.observableClass
        class TestPresenter extends BasePresenter()() {
          count = 0
          effectArgs: number[] = []

          afterObservable() {
            this.reaction(
              () => this.count,
              (val) => {
                this.effectArgs.push(val)
              },
              { fireImmediately: true },
            )
          }
        }

        const presenter = new TestPresenter({})

        expect(presenter.effectArgs).toEqual([0])
      })

      it("this.reaction({ fireImmediately: true }) passes prev as undefined on both sync seed and mount replay", () => {
        @ga.observableClass
        class PrevTrackingPresenter extends BasePresenter()() {
          count = 5
          calls: Array<{ val: number; prev: number | undefined }> = []

          afterObservable() {
            this.reaction(
              () => this.count,
              (val, prev) => {
                this.calls.push({ val, prev })
              },
              { fireImmediately: true },
            )
          }
        }

        const presenter = new PrevTrackingPresenter({})

        expect(presenter.calls).toEqual([{ val: 5, prev: undefined }])

        presenter.afterMountBase()

        expect(presenter.calls).toEqual([
          { val: 5, prev: undefined },
          { val: 5, prev: undefined },
        ])
      })

      it("this.reaction() without fireImmediately does NOT seed state", () => {
        @ga.observableClass
        class TestPresenter extends BasePresenter()() {
          count = 0
          effectArgs: number[] = []

          afterObservable() {
            this.reaction(
              () => this.count,
              (val) => {
                this.effectArgs.push(val)
              },
            )
          }
        }

        const presenter = new TestPresenter({})

        expect(presenter.effectArgs).toEqual([])
      })

      it("this.autorun() seeds state synchronously", () => {
        @ga.observableClass
        class TestPresenter extends BasePresenter()() {
          count = 0
          viewCalls: number[] = []

          afterObservable() {
            this.autorun(() => {
              this.viewCalls.push(this.count)
            })
          }
        }

        const presenter = new TestPresenter({})

        expect(presenter.viewCalls).toEqual([0])
      })
    })

    describe("afterMount (mounted path)", () => {
      it("this.reaction() sets up a lazy reaction that fires on next change only", () => {
        @ga.observableClass
        class TestPresenter extends BasePresenter()() {
          count = 0
          effectArgs: number[] = []

          override afterMount() {
            this.reaction(
              () => this.count,
              (val) => {
                this.effectArgs.push(val)
              },
            )
          }
        }

        const presenter = new TestPresenter({})
        presenter.afterMountBase()

        expect(presenter.effectArgs).toEqual([])

        runInAction(() => (presenter.count = 1))

        expect(presenter.effectArgs).toEqual([1])
      })

      it("this.reaction({ fireImmediately: true }) fires immediately on registration", () => {
        @ga.observableClass
        class TestPresenter extends BasePresenter()() {
          count = 5
          effectArgs: number[] = []

          override afterMount() {
            this.reaction(
              () => this.count,
              (val) => {
                this.effectArgs.push(val)
              },
              { fireImmediately: true },
            )
          }
        }

        const presenter = new TestPresenter({})
        presenter.afterMountBase()

        expect(presenter.effectArgs).toEqual([5])
      })

      it("this.autorun() fires immediately on registration", () => {
        @ga.observableClass
        class TestPresenter extends BasePresenter()() {
          count = 3
          viewCalls: number[] = []

          override afterMount() {
            this.autorun(() => {
              this.viewCalls.push(this.count)
            })
          }
        }

        const presenter = new TestPresenter({})
        presenter.afterMountBase()

        expect(presenter.viewCalls).toEqual([3])

        runInAction(() => (presenter.count = 7))

        expect(presenter.viewCalls).toEqual([3, 7])
      })
    })

    describe("destructor routing", () => {
      it("this.reaction() in afterMountOrPropChange routes destructors correctly", () => {
        @ga.observableClass
        class TestPresenter extends BasePresenter()() {
          count = 0
          effectArgs: number[] = []

          override afterMountOrPropChange() {
            this.reaction(
              () => this.count,
              (val) => {
                this.effectArgs.push(val)
              },
              { fireImmediately: true },
            )
          }
        }

        const presenter = new TestPresenter({})
        presenter.afterMountBase()
        presenter.afterMountOrPropChangeBase()

        runInAction(() => (presenter.count = 1))

        expect(presenter.effectArgs).toEqual([0, 1])

        presenter.destroyAfterMountOrOnPropChangeDestructors()
        runInAction(() => (presenter.count = 2))

        expect(presenter.effectArgs).toEqual([0, 1])
      })

      it("addDestructor (singular) in afterMountOrPropChange is prop-change-scoped", () => {
        const destructor = jest.fn()

        @ga.observableClass
        class TestPresenter extends BasePresenter()() {
          override afterMountOrPropChange() {
            this.addDestructor(destructor)
          }
        }

        const presenter = new TestPresenter({})
        presenter.afterMountBase()
        presenter.afterMountOrPropChangeBase()

        expect(destructor).not.toHaveBeenCalled()

        presenter.destroyAfterMountOrOnPropChangeDestructors()

        expect(destructor).toHaveBeenCalledTimes(1)
      })

      it("synchronous throw from afterMountOrPropChange propagates out of afterMountOrPropChangeBase", () => {
        @ga.observableClass
        class ThrowingPresenter extends BasePresenter()() {
          override afterMountOrPropChange() {
            throw new Error("sync error")
          }
        }

        const presenter = new ThrowingPresenter({})
        presenter.afterMountBase()
        expect(() => presenter.afterMountOrPropChangeBase()).toThrow("sync error")
      })

      it("async rejection from afterMountOrPropChange does not throw synchronously", async () => {
        @ga.observableClass
        class AsyncThrowingPresenter extends BasePresenter()() {
          override async afterMountOrPropChange(): Promise<void> {
            await Promise.resolve()
            throw new Error("async error")
          }
        }

        const presenter = new AsyncThrowingPresenter({})
        presenter.afterMountBase()
        await expect(presenter.afterMountOrPropChangeBase()).rejects.toThrow("async error")
      })

      it("addDestructor routes to prop-change scope even after a prior synchronous throw", () => {
        let shouldThrow = true
        const destructor = jest.fn()

        @ga.observableClass
        class SometimesThrowingPresenter extends BasePresenter()() {
          override afterMountOrPropChange() {
            if (shouldThrow) throw new Error("sync error")
            this.addDestructor(destructor)
          }
        }

        const presenter = new SometimesThrowingPresenter({})
        presenter.afterMountBase()

        // First call throws
        expect(() => presenter.afterMountOrPropChangeBase()).toThrow("sync error")

        // isInAfterMountOrPropChangeBase is reset by try/finally, so next call routes correctly
        shouldThrow = false
        presenter.afterMountOrPropChangeBase()

        expect(destructor).not.toHaveBeenCalled()
        presenter.destroyAfterMountOrOnPropChangeDestructors()
        expect(destructor).toHaveBeenCalledTimes(1)
      })
    })

    describe("phase transitions", () => {
      @ga.observableClass
      class PhasePresenter extends BasePresenter()() {
        count = 0
        effectArgs: number[] = []

        override afterMount() {
          this.reaction(
            () => this.count,
            (val) => {
              this.effectArgs.push(val)
            },
            { fireImmediately: true },
          )
        }
      }

      it("transitions constructing -> mounted -> destroyed", () => {
        const presenter = new PhasePresenter({})

        // constructing: afterMount reaction is not yet set up
        expect(presenter.effectArgs).toEqual([])

        // mounted: afterMount fires and sets up the reaction
        presenter.afterMountBase()
        expect(presenter.effectArgs).toEqual([0])

        runInAction(() => (presenter.count = 1))
        expect(presenter.effectArgs).toEqual([0, 1])

        // destroyed: reaction stops firing
        presenter.destroy()
        runInAction(() => (presenter.count = 2))
        expect(presenter.effectArgs).toEqual([0, 1])
      })

      it("StrictMode remount resets to mounted phase", () => {
        const presenter = new PhasePresenter({})

        // First mount
        presenter.afterMountBase()
        expect(presenter.effectArgs).toEqual([0])

        runInAction(() => (presenter.count = 1))
        expect(presenter.effectArgs).toEqual([0, 1])

        // StrictMode cleanup
        presenter.destroy()
        runInAction(() => (presenter.count = 2))
        expect(presenter.effectArgs).toEqual([0, 1])

        // Second mount — phase resets to mounted, afterMount reaction re-registers
        presenter.afterMountBase()
        expect(presenter.effectArgs).toEqual([0, 1, 2])

        runInAction(() => (presenter.count = 3))
        expect(presenter.effectArgs).toEqual([0, 1, 2, 3])
      })
    })

    describe("post-destroy guards", () => {
      @ga.observableClass
      class DestroyedGuardPresenter extends BasePresenter()() {
        reactionEffect = jest.fn()
        autorunEffect = jest.fn()
      }

      const createDestroyedPresenter = () => {
        const presenter = new DestroyedGuardPresenter({})
        presenter.afterMountBase()
        presenter.destroy()
        return presenter
      }

      it("no-ops reaction() on a destroyed presenter", () => {
        silenceLoggerWarnings("Attempted to add listener to destroyed presenter")
        const presenter = createDestroyedPresenter()

        presenter.reaction(() => 1, presenter.reactionEffect, { fireImmediately: true })

        expect(presenter.reactionEffect).not.toHaveBeenCalled()
      })

      it("no-ops autorun() on a destroyed presenter", () => {
        silenceLoggerWarnings("Attempted to add listener to destroyed presenter")
        const presenter = createDestroyedPresenter()

        presenter.autorun(presenter.autorunEffect)

        expect(presenter.autorunEffect).not.toHaveBeenCalled()
      })
    })
  })

  it("allows overriding the syncProps to add custom loading behavior", async () => {
    @ga.observableClass
    class CustomPresenter extends BasePresenter<{ state: "a" | "b"; searchQuery: string }>()(deps) {
      override async syncProps(props: { state: "a" | "b"; searchQuery: string }) {
        await this.rawAsyncDeps.asyncStateDep.load({ foo: props.searchQuery })

        return super.syncProps(props)
      }
    }

    const customPresenter = new CustomPresenter({ state: "a", searchQuery: "initial" })
    const loadPromise = customPresenter.reloadOnPropChange()

    await asyncState.markStateLoaded("a")
    await loadPromise

    const syncLoadPromise = customPresenter.syncProps({ state: "a", searchQuery: "new value" })

    await asyncState.markStateLoaded("a")
    await syncLoadPromise

    expect(asyncState.getDemoState("a").data).toEqual("new value")
  })
})
