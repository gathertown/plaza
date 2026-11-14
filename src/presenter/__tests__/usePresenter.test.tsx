import "@testing-library/jest-dom/extend-expect"

import { act, render as renderComponent, renderHook, screen } from "@testing-library/react"
import { observer } from "mobx-react-lite"
import { Component, ReactNode, StrictMode, Suspense, useEffect, useMemo, useState } from "react"

import { just } from "../../helpers"
import { autorun, Destructible, ga, markDeps, reaction, runInAction } from "../../mobx"
import { setUpErrorSilencing, silenceErrors, silenceLoggerErrors } from "../../testing"
import { AsyncState } from "../AsyncState"
import { BasePresenter } from "../BasePresenter"
import { MinimalPresenter } from "../presenterHelpers"
import { usePresenter } from "../usePresenter"

setUpErrorSilencing()

describe("#usePresenter", () => {
  const owner = new Destructible()
  const presenterDeps = (props: { foo?: string }) => ({
    firstDep: new AsyncState(owner, () => Promise.resolve(props.foo)),
  })
  @ga.observableClass
  class DefaultPresenter extends BasePresenter<{ foo?: string; simulateLoading?: boolean }>()(
    presenterDeps,
  ) {
    afterMountMockFn = jest.fn()
    afterMountOrPropChangeMockFn = jest.fn()

    constructor(props: { foo?: string; simulateLoading?: boolean }) {
      super(props)
    }

    get example() {
      return this.props.foo
    }
    get testVal() {
      return "test"
    }

    @ga.action
    someAction() {
      actionFn()
    }

    // noinspection JSUnusedGlobalSymbols
    get asyncDepsLoaded() {
      return !this.props.simulateLoading
    }

    reloadOnPropChange() {
      return reloadOnPropChangeFn()
    }

    override async afterMount() {
      this.afterMountMockFn()
    }

    override afterMountOrPropChange() {
      this.afterMountOrPropChangeMockFn()
    }

    destroy = destroyFn
  }

  const render = <T extends {}, A extends Record<string, unknown>>(
    PresenterClass: MinimalPresenter<T, A>,
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    presenterProps: A = {} as A,
  ) =>
    renderHook(({ props }: { props: A } = { props: presenterProps }) =>
      usePresenter(PresenterClass, props),
    )

  const reloadOnPropChangeFn = jest.fn().mockImplementation(() => new Promise(() => {}))
  const destroyFn = jest.fn()
  const actionFn = jest.fn()

  it("calls reloadOnPropChangeFn on the default presenter", () => {
    render(DefaultPresenter, { foo: "bar" })

    expect(reloadOnPropChangeFn).toHaveBeenCalledOnce()
  })

  it("loads with the props set initially", () => {
    const { result } = render(DefaultPresenter, { foo: "bar" })

    const { presenter } = result.current

    expect(presenter.props.foo).toEqual("bar")
    expect(presenter.testVal).toEqual("test")
  })

  it("syncs the props when they are updated", () => {
    const { result, rerender } = render(DefaultPresenter, { foo: "bar" })

    act(() => rerender({ props: { foo: "updated" } }))

    expect(reloadOnPropChangeFn).toHaveBeenCalledTimes(2)

    const { presenter } = result.current

    expect(presenter.props.foo).toEqual("updated")
  })

  it("calls an action on the presenter", () => {
    const { result } = render(DefaultPresenter)

    const { presenter } = result.current

    presenter.someAction()

    expect(actionFn).toHaveBeenCalled()
  })

  it("runs the afterMount after mount", () => {
    const { result } = render(DefaultPresenter)

    expect(result.current.presenter.afterMountMockFn).toHaveBeenCalledOnce()
  })

  it("does not run the afterMount on subsequent prop changes", () => {
    const { result, rerender } = render(DefaultPresenter, { foo: "bar" })
    expect(result.current.presenter.afterMountMockFn).toHaveBeenCalledOnce()

    act(() => rerender({ props: { foo: "updated" } }))

    expect(result.current.presenter.afterMountMockFn).toHaveBeenCalledOnce()
  })

  it("runs the afterMountOrPropChange after mount", () => {
    const { result } = render(DefaultPresenter)

    expect(result.current.presenter.afterMountOrPropChangeMockFn).toHaveBeenCalledOnce()
  })

  it("runs the afterMountOrPropChange after props change", () => {
    const { result, rerender } = render(DefaultPresenter, { foo: "bar" })

    act(() => rerender({ props: { foo: "updated" } }))

    expect(result.current.presenter.afterMountOrPropChangeMockFn).toHaveBeenCalledTimes(2)
  })

  it("throws a promise that is caught by suspense boundaries when loading", () => {
    const DummyComp = () => {
      usePresenter(DefaultPresenter, { simulateLoading: true })
      return <div />
    }
    const DummyFallback = () => <div>Loading...</div>

    renderComponent(
      <Suspense fallback={<DummyFallback />}>
        <DummyComp />
      </Suspense>,
    )

    const fallback = screen.getByText("Loading...")

    expect(fallback).toBeInTheDocument()
  })

  it("calls destroy when the component unmounts", () => {
    const { unmount } = render(DefaultPresenter)

    unmount()

    expect(destroyFn).toHaveBeenCalled()
  })

  it("rerenders the component only once and with the updated view model when the props change", async () => {
    const renderValues: string[] = []

    const Component = observer((props: { foo: string }) => {
      const clonedProps = Object.assign({}, props)
      const { presenter } = usePresenter(DefaultPresenter, clonedProps)

      // Add to the render values to track how many times the component is rendered
      // and what presenter.example is set to.
      renderValues.push(just(presenter.example))

      return (
        <>
          <div>{presenter.example}</div>
        </>
      )
    })

    const Wrapper = () => {
      const [foo, setFoo] = useState("bar")

      return (
        <div>
          <Component foo={foo} />
          <button onClick={() => setFoo("baz")}>Change foo</button>
        </div>
      )
    }

    renderComponent(<Wrapper />)

    const changeFooButton = screen.getByText("Change foo")

    await act(async () => {
      changeFooButton.click()
    })

    expect(renderValues).toEqual(["bar", "baz"])
  })

  describe("checking behavior of side effects / reactivity within React", () => {
    @ga.observableClass
    class TestPresenter extends BasePresenter()() {
      foo = 0
      constructor(props: Record<string, never>) {
        super(props)
        this.foo++
      }
      @ga.action.bound
      incrementFoo() {
        this.foo++
      }
    }

    // It's fine to have a presenter constructor that changes its own state. There are no issues.
    // Even if other components subsequently rely on the presenter, the state changes occur before
    // anything can set up reactions to the presenter. (More on this below.)
    it("triggering state change within constructor does not trigger re-render", () => {
      const rendered = jest.fn()
      const Component = observer(() => {
        rendered()
        const { presenter } = usePresenter(TestPresenter)
        return <div>foo: {presenter.foo}</div>
      })
      renderComponent(<Component />)
      const res = screen.getByText("foo:", { exact: false })
      expect(res.textContent).toEqual("foo: 1")
      expect(rendered).toHaveBeenCalledOnce()
    })

    // This isn't about presenters, but it's important to understand about React: it is
    // okay to trigger state changes that only create re-renders in the current component.
    // As long as it doesn't create an infinite loop, you're fine.
    // If you call `setState` while rendering, it will cause React to discard the render and run
    // again. https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
    it("is okay with triggering react state changes in a render if there is no infinite loop", () => {
      const rendered = jest.fn()
      const Component = observer(() => {
        rendered()
        const [foo, setFoo] = useState(0)
        if (foo === 0) {
          setFoo(foo + 1)
        }
        return <div>foo: {foo}</div>
      })
      renderComponent(<Component />)
      const res = screen.getByText("foo:", { exact: false })
      expect(res.textContent).toEqual("foo: 1")
      expect(rendered).toHaveBeenCalledTimes(2)
    })

    // Here we show that MobX state changes within the first render do not trigger re-renders,
    // even when we appear to be observing the MobX state.
    //
    // This one is quite surprising. The reason it doesn't create an infinite loop is that the
    // observers are only established _after the component returns from the render_. So in this
    // case, mutating an observable value inside the render function doesn't trigger an infinite
    // loop because at that point the observers aren't set up. This is true even if you reference
    // the observable value before mutating it. It is the return from the component render that
    // "sets up" the listeners in React to then trigger re-renders.
    //
    // This situation is basically always a bug. We're one render away from triggering an infinite
    // loop. But it's worth showing this nuance, because it can help you understand why some
    // code doesn't seem to be reacting initially if it's only making a single render.
    it("triggering MobX state change within first render does not trigger re-render", () => {
      const Component = observer(() => {
        const { presenter } = usePresenter(TestPresenter)
        markDeps(presenter.foo)
        presenter.incrementFoo()
        return <div>foo: {presenter.foo}</div>
      })
      renderComponent(<Component />) // no infinite loop
    })

    // MobX mutations performed inside a useMemo/useState do not trigger re-renders for similar
    // reasons to the test above: the reactivity is not yet set up until the initial render
    // function returns, and useState/useMemo run synchronously to the render call.
    it("triggering state changes in useMemo do not trigger a re-render", () => {
      const Component = observer(() => {
        const { presenter } = usePresenter(TestPresenter)
        presenter.incrementFoo()
        useMemo(() => {
          // if presenter.foo were reactive at this point, this would infinite loop
          presenter.incrementFoo()
        }, [presenter])
        return <div>foo: {presenter.foo}</div>
      })
      renderComponent(<Component />) // no infinite loop
    })

    // If you call `setState` while rendering, it will cause React to discard the render and run
    // again. https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
    // That might lead a person to think that it's dangerous to make state changes in the
    // presenter constructor. However, this is safe, because the constructor only runs once on the
    // first render.
    it("state changes from the presenter constructor are fine even on rerender", () => {
      const rendered = jest.fn()
      const Component = observer(function Component() {
        rendered()
        const { presenter } = usePresenter(TestPresenter)
        const [bar, setBar] = useState(0)
        useMemo(() => {
          setBar(bar + 1)
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [])
        return <div>foo: {presenter.foo}</div>
      })
      renderComponent(<Component />)
      const res = screen.getByText("foo:", { exact: false })
      expect(res.textContent).toEqual("foo: 1")
      expect(rendered).toHaveBeenCalledTimes(2)
    })

    // if you call `setState` while rendering, it will cause React to discard the render and run
    // again. This could lead to an infinite loop if you are changing MobX state as part of the
    // render. We can't immediately think of a case where this would happen, but it's worth naming
    // explicitly that calling presenter actions in the render (except the constructor) is risky.
    it("triggering react state changes does trigger an infinite loop", () => {
      // TBH, it's surprising React complains about this (because it's only rendering the one
      // component), not sure about it but this silences the warning. The point of this test
      // anyway is to illustrate the risks of infinite loops.
      silenceErrors(
        console,
        "error",
        "Cannot update a component (`%s`) while rendering a different component (`%s`). To locate the bad setState() call inside `%s`, follow the stack trace as described in https://react.dev/link/setstate-in-render",
      )
      let i = 0
      const Component = observer(function Component() {
        const { presenter } = usePresenter(TestPresenter)
        const [bar, setBar] = useState(0)
        // cause it to eventually abort so we can finish the test
        if (i++ < 50) {
          presenter.incrementFoo()
        }
        useMemo(() => {
          setBar(bar + 1)
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [])
        return <div>foo: {presenter.foo}</div>
      })
      renderComponent(<Component />)
      const res = screen.getByText("foo:", { exact: false })
      expect(res.textContent).toEqual("foo: 51") // indicates infinite loop
    })

    // Here we demonstrate that triggering repo state changes from a presenter constructor
    // has the risk of causing other components to re-render if they react to that repo value. Since
    // React doesn't like one component triggering a re-render of another component during its
    // render, we should avoid making global state changes from a presenter constructor.
    it("constructor triggering repo state changes are dangerous and could make React angry", () => {
      silenceErrors(
        console,
        "error",
        "Cannot update a component (`%s`) while rendering a different component (`%s`). To locate the bad setState() call inside `%s`, follow the stack trace as described in https://react.dev/link/setstate-in-render",
      )
      @ga.observableClass
      class SomeRepo extends Destructible {
        foo = 0
        @ga.action.bound
        incrementFoo() {
          this.foo++
        }
      }
      const someRepo = new SomeRepo()

      @ga.observableClass
      class TestPresenter extends BasePresenter()() {
        constructor(props: Record<string, never>) {
          super(props)
          someRepo.incrementFoo()
        }
      }

      // Below, we need to do some trickery to first set up a component to react to SomeRepo, and
      // then create a new component that will instantiate a presenter that triggers a change to
      // SomeRepo.
      const Wrapper = observer(() => {
        const [rendered, setRendered] = useState(false)
        return (
          <>
            <ComponentObservingRepo setRendered={setRendered} />
            {rendered && <WillTriggerRepoChangeThroughPresenter />}
          </>
        )
      })
      const ComponentObservingRepo = observer(
        ({ setRendered }: { setRendered: (x: boolean) => void }) => {
          useEffect(() => {
            setRendered(true)
          }, [setRendered])
          return <div>foo: {someRepo.foo}</div>
        },
      )
      const WillTriggerRepoChangeThroughPresenter = observer(() => {
        usePresenter(TestPresenter)
        return <div>trigger</div>
      })
      renderComponent(<Wrapper />)
      expect(screen.getByText("foo:", { exact: false }).textContent).toEqual("foo: 1")
    })

    // Under React `StrictMode` (dev-mode lazy-init double-invoke),
    // `useState`'s initializer fires twice: a first orphan presenter is constructed, then a
    // second presenter is constructed and committed. Only the committed one runs `useEffect` →
    // `afterMountBase` → `destroy`. Without `this.reaction`, the orphan's
    // synchronously-registered `reaction` would stay live for the page's lifetime — its destroy
    // is never called — and a single mutation would fire the orphan's effect plus the committed
    // presenter's effect.
    //
    // With the fix, the orphan only ever gets to the synchronous initial fire; its queued setup
    // is never invoked, so it never registers a real subscription. Only the committed presenter
    // does, and a single mutation fires its effect once.
    //
    // StrictMode also cycles the committed presenter through mount → cleanup → mount, which
    // exercises the requirement that `afterMountBase` re-registers subscriptions on each mount
    // (the prior mount's disposer was already fired by the cleanup `destroy`).
    it("does not leak orphan subscriptions for this.reaction under StrictMode", () => {
      @ga.observableClass
      class SharedRepo extends Destructible {
        someValue = 0
      }
      const sharedRepo = new SharedRepo()
      let liveSubscriptionFires = 0
      @ga.observableClass
      class TestPresenter extends BasePresenter()() {
        afterObservable() {
          this.reaction(
            () => sharedRepo.someValue,
            () => {
              liveSubscriptionFires++
            },
            { fireImmediately: true },
          )
        }
      }
      const Component = observer(function Component() {
        usePresenter(TestPresenter)
        return <div />
      })

      // Three mount/unmount cycles. Each mount under StrictMode lazy-init double-invokes
      // `useState` so two presenters are constructed: one orphan, one committed. The committed
      // presenter's destructors fire on unmount; the orphan's destructors never fire because the
      // orphan never reaches `useEffect`. Under buggy synchronous-registration, each cycle leaks
      // one orphan subscription. Under the fix, orphans never register a real subscription.
      for (let i = 0; i < 3; i++) {
        const { unmount } = renderComponent(
          <StrictMode>
            <Component />
          </StrictMode>,
        )
        unmount()
      }
      const firesAfterUnmount = liveSubscriptionFires

      runInAction(() => sharedRepo.someValue++)

      // Buggy: 3 orphan subscriptions → 3 fires. Fix: 0 alive subscriptions → 0 fires.
      expect(liveSubscriptionFires - firesAfterUnmount).toEqual(0)
    })

    // Under React StrictMode, useEffect cycles mount-1 → cleanup → mount-2 → unmount.
    it("does not leak addDestructors(reaction(...)) in afterMount under StrictMode", () => {
      @ga.observableClass
      class SharedRepo extends Destructible {
        someValue = 0
      }
      const sharedRepo = new SharedRepo()
      let liveSubscriptionFires = 0
      @ga.observableClass
      class TestPresenter extends BasePresenter()() {
        override afterMount() {
          this.addDestructors(
            reaction(
              () => sharedRepo.someValue,
              () => {
                liveSubscriptionFires++
              },
              { name: "afterMount StrictMode leak test" },
            ),
          )
        }
      }
      const Component = observer(function Component() {
        usePresenter(TestPresenter)
        return <div />
      })

      for (let i = 0; i < 3; i++) {
        const { unmount } = renderComponent(
          <StrictMode>
            <Component />
          </StrictMode>,
        )
        unmount()
      }
      const firesAfterUnmount = liveSubscriptionFires

      runInAction(() => sharedRepo.someValue++)

      expect(liveSubscriptionFires - firesAfterUnmount).toEqual(0)
    })

    it("tears down plain addDestructor callbacks from afterMount under StrictMode", () => {
      const cleanupFn = jest.fn()
      @ga.observableClass
      class TestPresenter extends BasePresenter()() {
        override afterMount() {
          this.addDestructor(cleanupFn)
        }
      }
      const Component = observer(function Component() {
        usePresenter(TestPresenter)
        return <div />
      })

      const { unmount } = renderComponent(
        <StrictMode>
          <Component />
        </StrictMode>,
      )
      unmount()

      // StrictMode will run mount → cleanup → mount-2 → unmount.
      expect(cleanupFn).toHaveBeenCalledTimes(2)
    })

    it("triggering repo state changes in an afterMount or similar would be fine", () => {
      @ga.observableClass
      class SomeRepo extends Destructible {
        foo = 0
        @ga.action.bound
        incrementFoo() {
          this.foo++
        }
      }
      const someRepo = new SomeRepo()

      @ga.observableClass
      class TestPresenter extends BasePresenter()() {
        override afterMount() {
          someRepo.incrementFoo()
        }
        override afterMountOrPropChange() {
          someRepo.incrementFoo()
        }
      }

      // Below, we need to do some trickery to first set up a component to react to SomeRepo, and
      // then create a new component that will instantiate a presenter that triggers a change to
      // SomeRepo.
      const Wrapper = observer(() => {
        const [rendered, setRendered] = useState(false)
        return (
          <>
            <ComponentObservingRepo setRendered={setRendered} />
            {rendered && <WillTriggerRepoChangeThroughPresenter />}
          </>
        )
      })
      const ComponentObservingRepo = observer(
        ({ setRendered }: { setRendered: (x: boolean) => void }) => {
          useEffect(() => {
            setRendered(true)
          }, [setRendered])
          return <div>foo: {someRepo.foo}</div>
        },
      )
      const WillTriggerRepoChangeThroughPresenter = observer(() => {
        usePresenter(TestPresenter)
        return <div>trigger</div>
      })
      renderComponent(<Wrapper />)
      expect(screen.getByText("foo:", { exact: false }).textContent).toEqual("foo: 2")
    })
  })

  describe("details about reactions and autoruns", () => {
    // autoruns in a constructor will not properly set up reactions because the fields are not
    // observable until the constructor finishes. (This is not specific to presenters.)
    it("autoruns in constructors do not react to state changes", async () => {
      const mockFn = jest.fn()
      @ga.observableClass
      class SomeModel extends Destructible {
        bar = 0
        constructor() {
          super()
          autorun(
            () => {
              mockFn(this.bar) // this will only run once and not react to changes
            },
            { name: "usePresenter.test.constructor" },
          )
        }
      }
      const presenter = new SomeModel()
      presenter.bar++

      expect(mockFn.mock.calls).toEqual([[0]])
    })

    // If you want to set up reactions, they must go in the afterObservable, afterMount,
    // or afterMountOrPropChange
    it("autoruns work in afterObservable, afterMount or afterMountOrPropChange", async () => {
      const mockFooFn = jest.fn()
      const mockBarFn = jest.fn()
      const mockBazFn = jest.fn()
      @ga.observableClass
      class TestPresenter extends BasePresenter()() {
        foo = 0
        bar = 10
        baz = 100
        afterObservable() {
          autorun(
            () => {
              mockFooFn(this.foo)
            },
            { name: "usePresenter.test.afterObs" },
          )
        }
        afterMount() {
          autorun(
            () => {
              mockBarFn(this.bar)
            },
            { name: "usePresenter.test.afterMount" },
          )
        }
        afterMountOrPropChange() {
          autorun(
            () => {
              mockBazFn(this.baz)
            },
            { name: "usePresenter.test.mountProp" },
          )
        }
      }
      const { result } = render(TestPresenter)

      runInAction(() => result.current.presenter.foo++)
      runInAction(() => result.current.presenter.bar++)
      runInAction(() => result.current.presenter.baz++)

      expect(mockFooFn.mock.calls).toEqual([[0], [1]])
      expect(mockBarFn.mock.calls).toEqual([[10], [11]])
      expect(mockBazFn.mock.calls).toEqual([[100], [101]])
    })
  })

  describe("details about props", () => {
    it("presenter props are not observable", () => {
      const mockFn = jest.fn()
      type Props = { foo: string }
      @ga.observableClass
      class TestPresenter extends BasePresenter<Props>()() {
        constructor(props: Props) {
          super(props)
          autorun(
            () => {
              mockFn(this.props.foo) // this will only run once and not react to changes
            },
            { name: "usePresenter.test.propsNotObs" },
          )
        }
      }
      const { rerender } = render(TestPresenter, { foo: "bar" })

      act(() => rerender({ props: { foo: "updated" } }))

      expect(mockFn).toHaveBeenCalledOnce()
    })

    // While presenter props are not observable, they will at least be not stale if they are
    // referenced in an autorun. However, if you're using props, you almost always want that to
    // live in `afterMountOrPropChange` so you can properly react to the props changing.
    it("presenter props remain fresh in an autorun", () => {
      const mockFn = jest.fn()
      type Props = { foo: string }
      @ga.observableClass
      class TestPresenter extends BasePresenter<Props>()() {
        bar = 0
        afterMount() {
          autorun(
            () => {
              markDeps(this.bar)
              mockFn(this.props.foo)
            },
            { name: "usePresenter.test.propsFresh" },
          )
        }
      }
      const { result, rerender } = render(TestPresenter, { foo: "bar" })
      act(() => rerender({ props: { foo: "updated" } }))

      runInAction(() => result.current.presenter.bar++)

      expect(mockFn).toHaveBeenCalledTimes(2)
      expect(mockFn).toHaveBeenLastCalledWith("updated")
    })

    it("props are made available in all the places", async () => {
      const ctrPropsFn = jest.fn()
      type Props = { foo: string }
      @ga.observableClass
      class TestPresenter extends BasePresenter<Props>()() {
        constructor(props: Props) {
          super(props)
          ctrPropsFn(this.props)
        }
      }

      render(TestPresenter, { foo: "bar" })

      expect(ctrPropsFn.mock.calls).toEqual([[{ foo: "bar" }]])
    })
  })

  describe("teardown of listeners", () => {
    const destroyCb = jest.fn()
    const afterObservableCb = jest.fn()
    const afterMountCb = jest.fn()
    const afterMountOrPropChangeCb = jest.fn()

    type Props = { foo: string }
    @ga.observableClass
    class TestPresenter extends BasePresenter<Props>()() {
      destroy() {
        destroyCb()
        super.destroy()
      }
      afterObservable() {
        this.addDestructor(afterObservableCb)
      }
      afterMount() {
        this.addDestructor(afterMountCb)
      }
      afterMountOrPropChange() {
        this.addDestructor(afterMountOrPropChangeCb)
      }
    }

    it("tears down listeners", () => {
      const { unmount } = render(TestPresenter, { foo: "bar" })
      expect(destroyCb).not.toHaveBeenCalledOnce()
      expect(afterObservableCb).not.toHaveBeenCalledOnce()
      expect(afterMountCb).not.toHaveBeenCalledOnce()
      expect(afterMountOrPropChangeCb).not.toHaveBeenCalledOnce()

      unmount()

      expect(destroyCb).toHaveBeenCalledOnce()
      expect(afterObservableCb).toHaveBeenCalledOnce()
      expect(afterMountCb).toHaveBeenCalledOnce()
      expect(afterMountOrPropChangeCb).toHaveBeenCalledOnce()
    })

    it("tears down listeners registered in afterMountOrPropChange when props change", () => {
      const { rerender, unmount } = render(TestPresenter, { foo: "bar" })

      act(() => rerender({ props: { foo: "updated" } }))

      expect(afterMountOrPropChangeCb).toHaveBeenCalledOnce()

      unmount()

      expect(afterMountOrPropChangeCb).toHaveBeenCalledTimes(2)
    })

    it("handles teardown errors in afterMountOrPropChange gracefully", () => {
      silenceLoggerErrors("Error while tearing down afterMountOrPropChange destructor")
      afterMountOrPropChangeCb.mockRejectedValueOnce(new Error("fake error"))
      const { unmount } = render(TestPresenter, { foo: "bar" })

      unmount()

      expect(afterMountOrPropChangeCb).toHaveBeenCalledTimes(1)
    })

    it("handles destructors in an async afterMount", async () => {
      @ga.observableClass
      class TestPresenter2 extends TestPresenter {
        override async afterMount() {
          this.addDestructor(afterMountCb)
        }
      }
      const { unmount } = render(TestPresenter2, { foo: "bar" })

      unmount()

      expect(afterMountCb).toHaveBeenCalledOnce()
    })

    it("does not handle destructors after an await (guarded against by eslint rule)", async () => {
      @ga.observableClass
      class TestPresenter2 extends TestPresenter {
        override async afterMount() {
          await Promise.resolve()
          this.addDestructor(afterMountCb)
        }
      }
      const { unmount } = render(TestPresenter2, { foo: "bar" })

      unmount()

      expect(afterMountCb).not.toHaveBeenCalledOnce()
    })
  })

  describe("error boundary propagation", () => {
    class TestErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
      state: { error: Error | null } = { error: null }

      static getDerivedStateFromError(error: Error) {
        return { error }
      }

      render() {
        if (this.state.error) return <div>Error: {this.state.error.message}</div>
        return this.props.children
      }
    }

    it("synchronous throw from afterMountOrPropChange reaches the error boundary", () => {
      @ga.observableClass
      class ThrowingPresenter extends BasePresenter()() {
        override afterMountOrPropChange() {
          throw new Error("sync afterMountOrPropChange error")
        }
      }
      const Comp = observer(() => {
        usePresenter(ThrowingPresenter, {})
        return <div>Rendered</div>
      })
      silenceErrors(console, "error", expect.any(String))

      renderComponent(
        <TestErrorBoundary>
          <Comp />
        </TestErrorBoundary>,
      )

      expect(screen.getByText("Error: sync afterMountOrPropChange error")).toBeInTheDocument()
    })

    it("synchronous throw from afterMount reaches the error boundary", () => {
      @ga.observableClass
      class ThrowingPresenter extends BasePresenter()() {
        override afterMount() {
          throw new Error("sync afterMount error")
        }
      }
      const Comp = observer(() => {
        usePresenter(ThrowingPresenter, {})
        return <div>Rendered</div>
      })
      silenceErrors(console, "error", expect.any(String))

      renderComponent(
        <TestErrorBoundary>
          <Comp />
        </TestErrorBoundary>,
      )

      expect(screen.getByText("Error: sync afterMount error")).toBeInTheDocument()
    })

    it("async throw from afterMountOrPropChange does NOT reach the error boundary", async () => {
      @ga.observableClass
      class AsyncThrowingPresenter extends BasePresenter()() {
        override async afterMountOrPropChange() {
          await Promise.resolve()
          throw new Error("async afterMountOrPropChange error")
        }
      }
      const Comp = observer(() => {
        usePresenter(AsyncThrowingPresenter, {})
        return <div>Rendered</div>
      })
      silenceLoggerErrors(
        "[Fire-and-forget promise rejected] Presenter afterMountOrPropChangeBase failed",
      )

      renderComponent(
        <TestErrorBoundary>
          <Comp />
        </TestErrorBoundary>,
      )
      await act(async () => {})

      expect(screen.getByText("Rendered")).toBeInTheDocument()
    })

    it("async throw from afterMount does NOT reach the error boundary", async () => {
      @ga.observableClass
      class AsyncThrowingPresenter extends BasePresenter()() {
        override async afterMount() {
          await Promise.resolve()
          throw new Error("async afterMount error")
        }
      }
      const Comp = observer(() => {
        usePresenter(AsyncThrowingPresenter, {})
        return <div>Rendered</div>
      })
      silenceLoggerErrors("[Fire-and-forget promise rejected] Presenter afterMountBase failed")

      renderComponent(
        <TestErrorBoundary>
          <Comp />
        </TestErrorBoundary>,
      )
      await act(async () => {})

      expect(screen.getByText("Rendered")).toBeInTheDocument()
    })
  })
})
