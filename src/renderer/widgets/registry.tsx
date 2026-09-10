import type { ReactNode } from 'react'
import type { WidgetSpan } from '@shared/widgets'
import type { WidgetContext, WidgetProps } from './context'
import {
  CaptureWidget,
  GraphWidget,
  HabitsWidget,
  PinnedWidget,
  StaleWidget,
  StatsWidget,
  STRIP_DAYS,
  TodayWidget
} from './builtins'

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
    kind: 'graph',
    label: 'Graph',
    hint: 'Pages and the links between them',
    defaultSpan: 6,
    frame: 'panel',
    dense: true,
    actions: () => <span className="nx-type-data">click a node to open it</span>,
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
    kind: 'stats',
    label: 'Vault',
    hint: 'Pages, links, open tasks, size on disk',
    defaultSpan: 3,
    frame: 'panel',
    Component: StatsWidget
  }
]

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
