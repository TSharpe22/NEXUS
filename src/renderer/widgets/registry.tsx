import type { ReactNode } from 'react'
import type { WidgetSpan } from '@shared/widgets'
import { fromISO, rangeFor } from '@shared/date-range'
import type { WidgetContext, WidgetProps } from './context'
import {
  CalendarWidget,
  CaptureWidget,
  GraphWidget,
  HabitsWidget,
  PinnedWidget,
  StaleWidget,
  WeekWidget,
  STRIP_DAYS,
  TodayWidget,
  ViewWidget,
  viewWidgetTitle
} from './builtins'
import { BriefingWidget } from './briefing'
import { ReviewWidget } from './review'
import { NextTaskWidget, QuoteWidget, TilesWidget } from './command'
import {
  TradingAccountsWidget,
  TradingCapitalWidget,
  TradingIncomeWidget,
  TradingOpsWidget,
  TradingPipelineWidget,
  TradingPortfolioWidget,
  TradingPracticeWidget,
  TradingSource,
  TradingPracticeSource,
  TradingSessionsWidget,
  TradingStrategiesWidget,
  TradingTesterWidget
} from './trading'

/**
 * Every widget Home knows how to draw.
 *
 * The same shape of table as `VIEW_LAYOUTS`, and for the same stated reason:
 * a new widget should be an entry here rather than a new feature. When add-ons
 * arrive, they register into this map — which is why nothing outside it may
 * assume the set of kinds is fixed or finite.
 */
export interface WidgetDefinition {
  kind: string
  /** What the "add a widget" menu calls it. */
  label: string
  hint: string
  defaultSpan: WidgetSpan
  /**
   * `panel` wraps the widget in the standard bordered box with a title.
   * `bare` lets it draw its own surface — the capture box is a control, not a
   * readout, and a panel around it looks like a panel with one input in it.
   */
  frame: 'panel' | 'bare'
  /** Tighter panel padding, for a widget that draws to its own edges. */
  dense?: boolean
  /**
   * What the panel header says, when the instance knows better than the kind
   * does. Three widgets all headed "A saved view" tell you nothing; three
   * headed "Open trades", "This week" and "Top 3" are a dashboard.
   */
  title?: (config: Record<string, unknown>, ctx: WidgetContext) => string | null
  /** Rendered in the panel header, right-aligned. Usually a link elsewhere. */
  actions?: (ctx: WidgetContext) => ReactNode
  Component: (props: WidgetProps) => JSX.Element | null
}

export const WIDGET_DEFINITIONS: WidgetDefinition[] = [
  {
    kind: 'capture',
    label: 'Capture box',
    hint: 'One line, filed without going anywhere',
    defaultSpan: 12,
    frame: 'bare',
    Component: CaptureWidget
  },
  {
    kind: 'today',
    label: 'Today',
    hint: "The journal entry, what's due, what's late",
    defaultSpan: 5,
    frame: 'panel',
    actions: (ctx) => (
      <button className="nx-home__link nx-type-data" onClick={() => ctx.goToTracker('week')}>
        tracker →
      </button>
    ),
    Component: TodayWidget
  },
  {
    kind: 'habits',
    label: 'Habits',
    hint: 'The last few days of every habit',
    defaultSpan: 4,
    frame: 'panel',
    actions: (ctx) => (
      <button className="nx-home__link nx-type-data" onClick={() => ctx.goToTracker('habits')}>
        {`last ${STRIP_DAYS} days · year →`}
      </button>
    ),
    Component: HabitsWidget
  },
  {
    kind: 'pinned',
    label: 'Pinned',
    hint: 'Pages kept on Home by hand',
    defaultSpan: 3,
    frame: 'panel',
    Component: PinnedWidget
  },
  {
    kind: 'view',
    label: 'A saved view',
    hint: 'The rows of one of your own questions',
    defaultSpan: 4,
    frame: 'panel',
    title: (config, ctx) => viewWidgetTitle(config, ctx.views),
    Component: ViewWidget
  },
  {
    kind: 'graph',
    label: 'Graph',
    hint: 'Pages, the links between them, their tags and folders',
    defaultSpan: 6,
    frame: 'panel',
    dense: true,
    actions: () => <span className="nx-type-data">drag · scroll to zoom · click to open</span>,
    Component: GraphWidget
  },
  {
    kind: 'stale',
    label: 'Stale',
    hint: 'What has gone quiet',
    defaultSpan: 3,
    frame: 'panel',
    actions: () => <span className="nx-type-data">untouched 30d+</span>,
    Component: StaleWidget
  },
  {
    kind: 'review',
    label: 'Due for review',
    hint: 'Concepts whose Check is due, per topic',
    defaultSpan: 12,
    frame: 'panel',
    title: () => 'Due for review',
    actions: (ctx) => (
      <button className="nx-home__link nx-type-data" onClick={() => ctx.goToTracker('review')}>
        review →
      </button>
    ),
    Component: ReviewWidget
  },
  {
    kind: 'briefing',
    label: 'Briefing',
    hint: "This morning's briefing from the Exec-Bot, and the reminders still to come",
    defaultSpan: 5,
    frame: 'panel',
    title: () => 'Briefing',
    actions: (ctx) => (
      <span className="nx-type-data">
        {fromISO(ctx.today).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
      </span>
    ),
    Component: BriefingWidget
  },
  {
    kind: 'calendar',
    label: 'Calendar',
    hint: 'Your calendar feeds, Monday to Sunday',
    defaultSpan: 12,
    frame: 'panel',
    Component: CalendarWidget
  },
  {
    kind: 'week',
    label: 'Week',
    hint: 'The seven days, what was logged on each, and the plan',
    defaultSpan: 7,
    frame: 'panel',
    title: (_config, ctx) => `Week · ${rangeFor('week', 0, fromISO(ctx.today)).label}`,
    actions: (ctx) => (
      <button className="nx-home__link nx-type-data" onClick={() => ctx.goToTracker('week')}>
        tracker →
      </button>
    ),
    Component: WeekWidget
  }
]

WIDGET_DEFINITIONS.push(
  {
    kind: 'tiles',
    label: 'Command navigation',
    hint: 'A list of the other command pages',
    defaultSpan: 4,
    frame: 'panel',
    title: () => 'Command navigation',
    Component: TilesWidget
  },
  {
    kind: 'quote',
    label: 'Quote',
    hint: 'A line to start from',
    defaultSpan: 12,
    frame: 'bare',
    Component: QuoteWidget
  },
  {
    kind: 'next-task',
    label: 'Next task',
    hint: 'The oldest late task, else the first due today',
    defaultSpan: 6,
    frame: 'panel',
    title: () => 'Next task',
    actions: (ctx) => (
      <button className="nx-home__link nx-type-data" onClick={() => ctx.goToTracker('week')}>
        tracker →
      </button>
    ),
    Component: NextTaskWidget
  }
)

/**
 * The Trading page (TRADING.md). Namespaced `trading.` as the contract in
 * `widgets.ts` asks of a family of kinds. Each header says whether what is
 * under it is the simulation or real.
 */
const mock = () => <TradingSource />
WIDGET_DEFINITIONS.push(
  {
    kind: 'trading.ops',
    label: 'Trading: data and execution',
    hint: 'Last import, fill rate, slippage',
    defaultSpan: 12,
    frame: 'panel',
    title: () => 'Ledger',
    Component: TradingOpsWidget
  },
  {
    kind: 'trading.accounts',
    label: 'Trading: accounts',
    hint: 'Status and drawdown buffer per account',
    defaultSpan: 7,
    frame: 'panel',
    title: () => 'Accounts · drawdown buffer',
    actions: mock,
    Component: TradingAccountsWidget
  },
  {
    kind: 'trading.strategies',
    label: 'Trading: strategies',
    hint: 'Live vs projected, kill flag, where each earns',
    defaultSpan: 5,
    frame: 'panel',
    title: () => 'Strategies · live vs projected',
    actions: mock,
    Component: TradingStrategiesWidget
  },
  {
    kind: 'trading.portfolio',
    label: 'Trading: portfolio',
    hint: 'Combined equity, drawdown, correlation',
    defaultSpan: 8,
    frame: 'panel',
    title: () => 'Portfolio',
    actions: mock,
    Component: TradingPortfolioWidget
  },
  {
    kind: 'trading.income',
    label: 'Trading: income',
    hint: 'Take-home against the threshold',
    defaultSpan: 4,
    frame: 'panel',
    title: () => 'To the threshold',
    actions: mock,
    Component: TradingIncomeWidget
  },
  {
    kind: 'trading.capital',
    label: 'Trading: capital',
    hint: 'Eval spend against payouts',
    defaultSpan: 4,
    frame: 'panel',
    title: () => 'Capital',
    actions: mock,
    Component: TradingCapitalWidget
  },
  {
    kind: 'trading.tester',
    label: 'Trading: strategy tester',
    hint: "TradingView's strategy tester runs",
    defaultSpan: 7,
    frame: 'panel',
    title: () => 'Strategy tester',
    Component: TradingTesterWidget
  },
  {
    kind: 'trading.pipeline',
    label: 'Trading: pipeline',
    hint: 'Idea → backtest → walk-forward → eval → live',
    defaultSpan: 5,
    frame: 'panel',
    title: () => 'Pipeline',
    actions: mock,
    Component: TradingPipelineWidget
  },
  {
    kind: 'trading.practice',
    label: 'Trading: practice',
    hint: 'Belt, reps, expectancy by setup',
    defaultSpan: 6,
    frame: 'panel',
    title: () => 'Practice',
    actions: (ctx) => <TradingPracticeSource ctx={ctx} />,
    Component: TradingPracticeWidget
  },
  {
    kind: 'trading.sessions',
    label: 'Trading: practice sessions',
    hint: 'Sim-lab sessions: the report, and a note for each',
    defaultSpan: 7,
    frame: 'panel',
    title: () => 'Practice sessions',
    actions: () => <TradingSource real />,
    Component: TradingSessionsWidget
  }
)

const BY_KIND = new Map(WIDGET_DEFINITIONS.map((d) => [d.kind, d]))

/**
 * The definition for a kind, or `undefined` when nothing has registered it.
 *
 * Callers must handle `undefined` rather than treating it as impossible: a
 * dashboard can name a widget that this build does not have — written by a
 * newer Nexus, or by an add-on that is not installed. `normaliseDashboard`
 * keeps those instances precisely so they survive being written back.
 */
export function widgetFor(kind: string): WidgetDefinition | undefined {
  return BY_KIND.get(kind)
}
