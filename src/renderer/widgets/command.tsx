import { useEffect, useState } from 'react'
import type { TrackerTask } from '@shared/types'
import { HOME_ID } from '@shared/commands'
import type { WidgetProps } from './context'
import { TaskRow } from './builtins'

/**
 * The widgets that make Home a hub: the list of command pages, the quote, and
 * the one next thing to do.
 */

/**
 * Command navigation: every command page but the one it is on, as a short
 * list. Stored as kind `tiles` — it started as big Anytype-style tiles, and a
 * stored kind is never renamed.
 */
export function TilesWidget({ ctx }: WidgetProps) {
  const pages = ctx.commandPages.filter((p) => p.id !== ctx.commandId)
  if (pages.length === 0) {
    return (
      <div className="nx-home__hint nx-type-data">
        No other command pages. Add one with + beside Command in the sidebar.
      </div>
    )
  }
  return (
    <nav className="nx-cmdnav" aria-label="Command pages">
      {pages.map((p) => (
        <button
          key={p.id}
          className={`nx-cmdnav__row ${p.color ? `nx-cmdnav__row--${p.color}` : ''}`}
          onClick={() => ctx.openCommand(p.id)}
        >
          <span className="nx-cmdnav__mark" aria-hidden />
          <span className="nx-cmdnav__name">{p.name}</span>
          <span className="nx-cmdnav__go nx-type-data">{p.id === HOME_ID ? 'hub' : '→'}</span>
        </button>
      ))}
    </nav>
  )
}

const QUOTE = {
  text: 'You must be ready to burn yourself in your own flame; how could you become new if you have not first become ashes?',
  by: 'Nietzsche · Thus Spoke Zarathustra'
}

/** One line to start from. The lock screen's quote unless the instance carries its own. */
export function QuoteWidget({ config }: WidgetProps) {
  const own = typeof config.text === 'string' && config.text.trim() ? config.text : null
  const text = own ?? QUOTE.text
  const by = own ? (typeof config.by === 'string' ? config.by : '') : QUOTE.by
  return (
    <blockquote className="nx-quote">
      {text}
      {by && <cite className="nx-type-data">{by}</cite>}
    </blockquote>
  )
}

/**
 * The next task: the oldest overdue one, else the first due today. One line,
 * tickable, because on a day with no room the question is only "what now".
 */
export function NextTaskWidget({ ctx }: WidgetProps) {
  const [task, setTask] = useState<TrackerTask | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    void Promise.all([ctx.read.tasksOverdue(ctx.today), ctx.read.tasksInRange(ctx.today, ctx.today)]).then(
      ([overdue, today]) => {
        if (cancelled) return
        const open = [...overdue, ...today].filter((t) => !t.isDone)
        setTask(open[0] ?? null)
      }
    )
    return () => {
      cancelled = true
    }
  }, [ctx.read, ctx.today, ctx.pages])

  if (task === undefined) return null
  if (task === null) {
    return <div className="nx-next nx-home__hint nx-type-data">Nothing due. Nothing late.</div>
  }

  return (
    <div className="nx-next">
      <TaskRow
        task={task}
        onToggle={async (t) => {
          await ctx.write.setTaskDone(t.pageId, t.blockId, !t.isDone)
          ctx.reload()
        }}
        onReschedule={async (t, due) => {
          await ctx.write.setTaskDue(t.pageId, t.blockId, due)
          ctx.reload()
        }}
        onOpen={ctx.openPage}
      />
    </div>
  )
}
