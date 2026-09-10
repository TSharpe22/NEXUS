import type {
  CaptureTarget,
  GraphData,
  HabitCandidate,
  HabitDay,
  Page,
  PageListItem,
  StorageStats,
  TrackerTask,
  TypeDef
} from '@shared/types'
import type { TrackerMode } from '../store/app-store'

/**
 * Everything a widget is allowed to do.
 *
 * This is the capability boundary, and it exists before it is strictly needed
 * on purpose. Today every component in the renderer reaches `window.api`
 * directly, which is the whole preload surface — including `pages.hardDelete`,
 * `stats.restoreBackup`, `files.reclaim` and the file dialogs. That is fine
 * while every component is one we wrote. It stops being fine the moment a
 * widget can come from somewhere else, and by then the boundary is a breaking
 * change for everything already written against its absence.
 *
 * So: a widget receives this and never touches `window.api`. What is missing
 * from it is the point — there is no delete, no restore, no reclaim, no
 * dialog, no import and no export here. Adding a capability later is additive;
 * taking one away after add-ons exist is not.
 */
export interface WidgetContext {
  /** The logical day, not the wall-clock one. See `shared/day.ts`. */
  today: string
  /** Page metadata only — bodies are not handed out. */
  pages: PageListItem[]
  types: TypeDef[]

  openPage(id: string): void
  goToTracker(mode: TrackerMode): void
  /** Start today's journal entry, creating it if it does not exist. */
  openTodayEntry(): Promise<Page>

  /**
   * Tell the dashboard that something a widget wrote may have changed what
   * other widgets are showing. Widgets do not refetch each other.
   */
  reload(): void

  read: {
    /** Today's entry if there is one. Never creates it — looking must not write. */
    journalPeek(): Promise<Page | null>
    tasksInRange(from: string, to: string): Promise<TrackerTask[]>
    tasksOverdue(before: string): Promise<TrackerTask[]>
    storage(): Promise<StorageStats>
    graph(): Promise<GraphData>
    habitCandidates(): Promise<HabitCandidate[]>
    habitDays(
      typeId: string,
      dateKey: string,
      booleanKey: string,
      from: string,
      to: string
    ): Promise<HabitDay[]>
  }

  write: {
    setTaskDone(pageId: string, blockId: string, done: boolean): Promise<void>
    setTaskDue(pageId: string, blockId: string, due: string | null): Promise<void>
    setPinned(pageId: string, pinned: boolean): Promise<void>
    checkInHabit(
      typeId: string,
      dateKey: string,
      booleanKey: string,
      date: string,
      done: boolean
    ): Promise<HabitDay>
    capture(text: string, target: CaptureTarget): Promise<Page>
  }
}

/** Props every widget component is rendered with. */
export interface WidgetProps {
  /** This instance's own settings, opaque to everything but the widget. */
  config: Record<string, unknown>
  ctx: WidgetContext
}
