import "@testing-library/jest-dom/extend-expect"

import { act, render, screen } from "@testing-library/react"
import { observer } from "mobx-react-lite"

import { just } from "../../helpers"
import { ga, runInAction } from "../../mobx"
import { BasePresenter } from "../../presenter/BasePresenter"
import {
  PresenterOverrides,
  PresenterOverridesContext,
} from "../../presenter/PresenterOverridesContext"
import { usePresenter } from "../../presenter/usePresenter"
import {
  mergeOverrides,
  overridePresenter,
  withLivePresenterMock,
  withPresenterOverrides,
} from "../presenterOverrides"

// The decorators feed usePresenter through the context, which only reads it in Storybook builds.
jest.mock("../../presenter/isRunningInStorybook", () => ({ isRunningInStorybook: () => true }))

type CounterProps = { start: number }

@ga.observableClass
class CounterPresenter extends BasePresenter<CounterProps>()() {
  count: number

  constructor(props: CounterProps) {
    super(props)
    this.count = props.start
  }
}

@ga.observableClass
class HookedCounterPresenter extends BasePresenter<CounterProps>()() {
  count = 0

  afterObservable() {
    this.count = this.props.start
  }
}

const overridesValue = (entries: ReturnType<typeof overridePresenter>[]): PresenterOverrides => ({
  byClass: new Map(entries),
})

describe("#mergeOverrides", () => {
  it("lets a child override win over the parent for the same class", () => {
    const parentEntry = overridePresenter(CounterPresenter, () => ({ count: 1 }))
    const childEntry = overridePresenter(CounterPresenter, () => ({ count: 2 }))
    const parent = mergeOverrides(undefined, [parentEntry])

    const merged = mergeOverrides(parent, [childEntry])

    expect(merged.byClass.get(CounterPresenter)).toBe(childEntry[1])
  })

  it("carries the parent's entries into the merged result", () => {
    const parentEntry = overridePresenter(CounterPresenter, () => ({ count: 1 }))
    const parent = mergeOverrides(undefined, [parentEntry])

    expect(mergeOverrides(parent, []).byClass.get(CounterPresenter)).toBe(parentEntry[1])
  })

  it("throws when the same class is registered twice in one decorator", () => {
    const entries = [
      overridePresenter(CounterPresenter, () => ({ count: 1 })),
      overridePresenter(CounterPresenter, () => ({ count: 2 })),
    ]

    // Anchored `$` proves the @ga.observableClass "ObservableWrapper" suffix was stripped.
    expect(() => mergeOverrides(undefined, entries)).toThrow(
      /Duplicate presenter override for CounterPresenter$/,
    )
  })
})

describe("#overridePresenter", () => {
  it("accepts real view-model fields and rejects unknown or infrastructure fields (compile-time)", () => {
    const entry = overridePresenter(CounterPresenter, () => ({ count: 1 }))
    expect(entry[0]).toBe(CounterPresenter)

    // @ts-expect-error `nope` is not a field on CounterPresenter
    overridePresenter(CounterPresenter, () => ({ nope: 1 }))
    // @ts-expect-error `props` is BasePresenter infrastructure, not an overridable view-model field
    overridePresenter(CounterPresenter, () => ({ props: { start: 1 } }))
    // @ts-expect-error `syncProps` is lifecycle plumbing, not overridable
    overridePresenter(CounterPresenter, () => ({ syncProps: () => {} }))
  })

  it("leaves the afterObservable hook out of the required fields (compile-time)", () => {
    const entry = overridePresenter(HookedCounterPresenter, () => ({ count: 1 }))

    expect(entry[0]).toBe(HookedCounterPresenter)
  })

  it("makes the mock's fields observable so mutations re-render observer components", () => {
    let captured: CounterPresenter | undefined
    const Comp = observer(() => {
      const { presenter } = usePresenter(CounterPresenter, { start: 0 })
      captured = presenter
      return <div>count: {presenter.count}</div>
    })

    render(
      <PresenterOverridesContext.Provider
        value={overridesValue([overridePresenter(CounterPresenter, () => ({ count: 1 }))])}
      >
        <Comp />
      </PresenterOverridesContext.Provider>,
    )
    expect(screen.getByText("count: 1")).toBeInTheDocument()

    act(() => runInAction(() => (just(captured).count = 5)))

    expect(screen.getByText("count: 5")).toBeInTheDocument()
  })
})

describe("#withPresenterOverrides", () => {
  it("resolves the child override when providers are nested", () => {
    const Comp = observer(() => {
      const { presenter } = usePresenter(CounterPresenter, { start: 0 })
      return <div>count: {presenter.count}</div>
    })
    const Story = () => <Comp />
    const outer = withPresenterOverrides([
      overridePresenter(CounterPresenter, () => ({ count: 1 })),
    ])
    const inner = withPresenterOverrides([
      overridePresenter(CounterPresenter, () => ({ count: 2 })),
    ])
    // Storybook renders decorators as components; call them inside a component so their hooks run.
    const InnerDecorated = () => inner(Story, storyContext({ count: 0 }))
    const OuterHarness = () => outer(InnerDecorated, storyContext({ count: 0 }))

    render(<OuterHarness />)

    expect(screen.getByText("count: 2")).toBeInTheDocument()
  })
})

type LiveArgs = { count: number }

const storyContext = (args: LiveArgs) => ({ args })

describe("#withLivePresenterMock", () => {
  const LiveComp = observer(() => {
    const { presenter } = usePresenter(CounterPresenter, { start: 0 })
    return <div>count: {presenter.count}</div>
  })
  const Story = () => (
    <>
      <LiveComp />
      <LiveComp />
    </>
  )
  const decorator = withLivePresenterMock(CounterPresenter, (args: LiveArgs) => ({
    count: args.count,
  }))
  const Harness = ({ count }: LiveArgs) => decorator(Story, storyContext({ count }))

  it("syncs mapped args into every mounted mock after an args change", () => {
    const { rerender } = render(<Harness count={0} />)
    expect(screen.getAllByText("count: 0")).toHaveLength(2)

    act(() => rerender(<Harness count={4} />))

    expect(screen.getAllByText("count: 4")).toHaveLength(2)
  })

  it("builds fresh mocks seeded from the current args on each mount", () => {
    const first = render(<Harness count={2} />)
    expect(first.getAllByText("count: 2")).toHaveLength(2)
    first.unmount()

    render(<Harness count={9} />)

    expect(screen.getAllByText("count: 9")).toHaveLength(2)
  })

  it("does not crash when a mapped field is a getter", () => {
    // A getter becomes a computed on the mock; the arg-sync must skip it rather than assign (which
    // would throw on a computed). The value derives through the getter's own closure, not sync.
    const getterDecorator = withLivePresenterMock(CounterPresenter, (args: LiveArgs) => ({
      get count() {
        return args.count * 10
      },
    }))
    const SingleStory = () => <LiveComp />
    const GetterHarness = ({ count }: LiveArgs) =>
      getterDecorator(SingleStory, storyContext({ count }))

    const { rerender } = render(<GetterHarness count={1} />)
    expect(screen.getByText("count: 10")).toBeInTheDocument()

    act(() => rerender(<GetterHarness count={3} />))

    expect(screen.getByText("count: 10")).toBeInTheDocument()
  })
})
