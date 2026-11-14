import "@testing-library/jest-dom/extend-expect"

import { act, render as renderComponent, renderHook, screen } from "@testing-library/react"
import { expectTypeOf } from "expect-type"
import { observer } from "mobx-react-lite"
import { ReactNode, StrictMode, Suspense } from "react"

import { ga } from "../../mobx"
import { BasePresenter } from "../BasePresenter"
import { overridePresenter } from "../overridePresenter"
import { MinimalPresenter } from "../presenterHelpers"
import {
  createPresenterOverrideEntry,
  PresenterOverrides,
  PresenterOverridesContext,
  resolvePresenterOverride,
} from "../PresenterOverridesContext"
import { usePresenter } from "../usePresenter"

// Default the suite to the Storybook build so usePresenter reads overrides from the context. The
// build-time selection of usePresenterOverrides is covered separately in
// PresenterOverridesContext.isolated.test.ts (needs per-case module isolation).
jest.mock("../isRunningInStorybook", () => ({ isRunningInStorybook: () => true }))

const constructorSpy = jest.fn()

type CounterProps = { start: number }

@ga.observableClass
class CounterPresenter extends BasePresenter<CounterProps>()() {
  count: number

  constructor(props: CounterProps) {
    super(props)
    constructorSpy(props)
    this.count = props.start
  }
}

const overridesValue = (entries: ReturnType<typeof overridePresenter>[]): PresenterOverrides => ({
  byClass: new Map(entries),
})

const renderPresenterHook = <T extends {}, A extends Record<string, unknown>>(
  PresenterClass: MinimalPresenter<T, A>,
  presenterProps: A,
  overrides: PresenterOverrides | undefined,
) =>
  renderHook(
    ({ props }: { props: A } = { props: presenterProps }) => usePresenter(PresenterClass, props),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <PresenterOverridesContext.Provider value={overrides}>
          {children}
        </PresenterOverridesContext.Provider>
      ),
    },
  )

describe("#resolvePresenterOverride", () => {
  it("constructs the real presenter when there are no overrides", () => {
    const resolved = resolvePresenterOverride(CounterPresenter, { start: 1 }, undefined)

    expect(resolved.count).toEqual(1)
  })

  it("returns the mock built by the matching factory", () => {
    const overrides = overridesValue([overridePresenter(CounterPresenter, () => ({ count: 99 }))])

    const resolved = resolvePresenterOverride(CounterPresenter, { start: 1 }, overrides)

    expect(resolved.count).toEqual(99)
  })

  it("throws naming the class when the class is unlisted under a provider", () => {
    const overrides = overridesValue([])

    // Trailing "." proves the @ga.observableClass "ObservableWrapper" suffix was stripped.
    expect(() => resolvePresenterOverride(CounterPresenter, { start: 1 }, overrides)).toThrow(
      "No presenter override registered for CounterPresenter. Add one",
    )
  })

  it("matches on exact constructor identity, not subclasses", () => {
    @ga.observableClass
    class SubCounterPresenter extends CounterPresenter {}
    const overrides = overridesValue([overridePresenter(CounterPresenter, () => ({ count: 1 }))])

    expect(() => resolvePresenterOverride(SubCounterPresenter, { start: 1 }, overrides)).toThrow(
      "No presenter override registered for SubCounterPresenter. Add one",
    )
  })
})

describe("#usePresenter with overrides", () => {
  it("constructs the real presenter when there is no provider value", () => {
    const { result } = renderPresenterHook(CounterPresenter, { start: 7 }, undefined)

    expect(constructorSpy).toHaveBeenCalledWith({ start: 7 })
    expect(result.current.presenter.count).toEqual(7)
  })

  it("uses the override factory and never runs the real constructor", () => {
    const overrides = overridesValue([overridePresenter(CounterPresenter, () => ({ count: 42 }))])

    const { result } = renderPresenterHook(CounterPresenter, { start: 7 }, overrides)

    expect(result.current.presenter.count).toEqual(42)
    expect(constructorSpy).not.toHaveBeenCalled()
  })

  it("builds a distinct mock seeded with each hook's initial props", () => {
    const overrides = overridesValue([
      overridePresenter(CounterPresenter, (props) => ({ count: props.start })),
    ])
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PresenterOverridesContext.Provider value={overrides}>
        {children}
      </PresenterOverridesContext.Provider>
    )

    const { result } = renderHook(
      () => ({
        first: usePresenter(CounterPresenter, { start: 1 }),
        second: usePresenter(CounterPresenter, { start: 2 }),
      }),
      { wrapper },
    )

    expect(result.current.first.presenter.count).toEqual(1)
    expect(result.current.second.presenter.count).toEqual(2)
    expect(result.current.first.presenter).not.toBe(result.current.second.presenter)
  })

  it("syncs props onto the mock when they change", () => {
    const overrides = overridesValue([
      overridePresenter(CounterPresenter, (props) => ({ count: props.start })),
    ])

    const { result, rerender } = renderPresenterHook(CounterPresenter, { start: 1 }, overrides)

    act(() => rerender({ props: { start: 5 } }))

    expect(result.current.presenter.props).toEqual({ start: 5 })
  })

  it("does not destroy a sibling's mock when one hook unmounts", () => {
    const onDestroy = jest.fn()
    const overrides = overridesValue([
      overridePresenter(CounterPresenter, () => ({ count: 0 }), { onDestroy }),
    ])
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PresenterOverridesContext.Provider value={overrides}>
        {children}
      </PresenterOverridesContext.Provider>
    )

    const kept = renderHook(() => usePresenter(CounterPresenter, { start: 0 }), { wrapper })
    const removed = renderHook(() => usePresenter(CounterPresenter, { start: 0 }), { wrapper })

    removed.unmount()

    expect(onDestroy).toHaveBeenCalledOnce()
    expect(kept.result.current.presenter.count).toEqual(0)
  })

  it("runs the mock lifecycle across mount, prop change and unmount", () => {
    const afterMount = jest.fn()
    const afterMountOrPropChange = jest.fn()
    const onDestroy = jest.fn()
    const overrides = overridesValue([
      overridePresenter(CounterPresenter, () => ({ count: 0 }), {
        afterMount,
        afterMountOrPropChange,
        onDestroy,
      }),
    ])

    const { rerender, unmount } = renderPresenterHook(CounterPresenter, { start: 1 }, overrides)
    expect(afterMount).toHaveBeenCalledOnce()
    expect(afterMountOrPropChange).toHaveBeenCalledOnce()

    act(() => rerender({ props: { start: 2 } }))
    expect(afterMount).toHaveBeenCalledOnce()
    expect(afterMountOrPropChange).toHaveBeenCalledTimes(2)

    unmount()
    expect(onDestroy).toHaveBeenCalledOnce()
  })

  it("tears the mock down through StrictMode's mount-cleanup-remount", () => {
    const afterMount = jest.fn()
    const onDestroy = jest.fn()
    const overrides = overridesValue([
      overridePresenter(CounterPresenter, () => ({ count: 0 }), { afterMount, onDestroy }),
    ])
    const Comp = observer(() => {
      usePresenter(CounterPresenter, { start: 0 })
      return <div>rendered</div>
    })

    const { unmount } = renderComponent(
      <StrictMode>
        <PresenterOverridesContext.Provider value={overrides}>
          <Comp />
        </PresenterOverridesContext.Provider>
      </StrictMode>,
    )
    unmount()

    expect(afterMount).toHaveBeenCalledTimes(2)
    expect(onDestroy).toHaveBeenCalled()
  })

  it("suspends on a never-resolving loading mock", () => {
    const overrides = overridesValue([
      overridePresenter(CounterPresenter, () => ({ count: 0 }), { loading: "forever" }),
    ])
    const Comp = observer(() => {
      usePresenter(CounterPresenter, { start: 0 })
      return <div>loaded</div>
    })

    renderComponent(
      <Suspense fallback={<div>loading</div>}>
        <PresenterOverridesContext.Provider value={overrides}>
          <Comp />
        </PresenterOverridesContext.Provider>
      </Suspense>,
    )

    expect(screen.getByText("loading")).toBeInTheDocument()
  })

  it("reaches loaded content once a resolving loading mock settles", async () => {
    const overrides = overridesValue([
      overridePresenter(CounterPresenter, () => ({ count: 0 }), {
        loading: Promise.resolve("ready"),
      }),
    ])
    const Comp = observer(() => {
      usePresenter(CounterPresenter, { start: 0 })
      return <div>loaded</div>
    })

    renderComponent(
      <Suspense fallback={<div>loading</div>}>
        <PresenterOverridesContext.Provider value={overrides}>
          <Comp />
        </PresenterOverridesContext.Provider>
      </Suspense>,
    )

    expect(await screen.findByText("loaded")).toBeInTheDocument()
  })
})

describe("#createPresenterOverrideEntry", () => {
  it("only takes a factory that builds the presenter's instance", () => {
    expectTypeOf(createPresenterOverrideEntry<CounterPresenter, Record<string, never>>)
      .parameter(1)
      .not.toEqualTypeOf<() => object>()
  })
})
