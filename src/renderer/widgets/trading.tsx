import { useEffect, useState } from 'react'
import { DRILL_NAMES, type PipelineStage, type PracticeSessionReport, type PracticeSessionSummary, type TesterRun, type TradingSnapshot } from '@shared/trading'
import type { WidgetContext, WidgetProps } from './context'
import './trading.css'

/**
 * The Trading page's panels (TRADING.md, "What Nexus should present").
 *
 * Each reads the same snapshot — `trading.db` once it exists, the simulation
 * until then — and only displays it: the arithmetic is the ledger's, never
 * redone here. The test for each panel is the plan's: if this number changed,
 * would you act differently?
 */

// One fetch per day shared by every panel, rather than one each.
let cached: { today: string; promise: Promise<TradingSnapshot> } | null = null
function useSnapshot(ctx: WidgetContext): TradingSnapshot | null {
  const [snap, setSnap] = useState<TradingSnapshot | null>(null)
  useEffect(() => {
    if (!cached || cached.today !== ctx.today) {
      cached = { today: ctx.today, promise: ctx.read.tradingSnapshot(ctx.today) }
    }
    let cancelled = false
    void cached.promise.then((s) => !cancelled && setSnap(s))
    return () => {
      cancelled = true
    }
  }, [ctx.read, ctx.today])
  return snap
}

const usd = (n: number, signed = false) =>
  `${signed && n > 0 ? '+' : n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`
const pct = (n: number) => `${Math.round(n * 100)}%`

/** A line over `values`, with the zero line drawn when it is in range. */
function Curve({ values, height = 60, tone }: { values: number[]; height?: number; tone?: 'up' | 'down' }) {
  if (values.length < 2) return null
  const w = 300
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  const span = max - min || 1
  const y = (v: number) => height - 2 - ((v - min) / span) * (height - 4)
  const x = (i: number) => (i / (values.length - 1)) * w
  const line = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const end = values[values.length - 1]
  const cls = tone ?? (end >= values[0] ? 'up' : 'down')
  return (
    <svg className={`nx-tr-curve is-${cls}`} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ height }}>
      {min < 0 && max > 0 && <line className="nx-tr-curve__zero" x1={0} x2={w} y1={y(0)} y2={y(0)} />}
      <polygon className="nx-tr-curve__fill" points={`0,${y(min < 0 ? 0 : min)} ${line} ${w},${y(min < 0 ? 0 : min)}`} />
      <polyline className="nx-tr-curve__line" points={line} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** A filled share of a track; `level` colours it. */
function Meter({ share, level }: { share: number; level: 'ok' | 'warn' | 'bad' | 'plain' }) {
  return (
    <span className="nx-tr-meter">
      <span className={`nx-tr-meter__fill is-${level}`} style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%` }} />
    </span>
  )
}

function Waiting() {
  return <div className="nx-home__hint nx-type-data">Reading the ledger…</div>
}

/** What the panel header says about where the numbers came from. */
export function TradingSource({ real }: { real?: boolean }) {
  return <span className={`nx-tr-source nx-type-data ${real ? 'is-real' : ''}`}>{real ? 'real' : 'mock'}</span>
}

// ------------------------------------------------------------------

/** Data freshness and execution: the line that says whether to trust the rest. */
export function TradingOpsWidget({ ctx }: WidgetProps) {
  const s = useSnapshot(ctx)
  if (!s) return <Waiting />
  const stale = s.importAgeDays > 2
  return (
    <div className="nx-tr-ops">
      <span className={`nx-tr-ops__item ${stale ? 'is-bad' : ''}`}>
        last import {s.importAgeDays === 0 ? 'today' : `${s.importAgeDays} days ago`}
      </span>
      <span className="nx-tr-ops__item">signals filled {pct(s.execution.fillRate)}</span>
      <span className="nx-tr-ops__item">slippage {s.execution.slippage} pt</span>
      <span className="nx-tr-ops__item">
        {s.accounts.filter((a) => a.status !== 'blown').length} accounts ·{' '}
        {s.strategies.filter((t) => t.stage === 'live').length} strategies live
      </span>
      <TradingSource />
    </div>
  )
}

export function TradingAccountsWidget({ ctx }: WidgetProps) {
  const s = useSnapshot(ctx)
  if (!s) return <Waiting />
  return (
    <div className="nx-tr-rows">
      {s.accounts.map((a) => {
        const share = a.buffer / a.drawdown
        const level = a.status === 'blown' ? 'bad' : share < 0.35 ? 'bad' : share < 0.6 ? 'warn' : 'ok'
        return (
          <div key={a.id} className="nx-tr-acct">
            <div className="nx-tr-acct__name">
              {a.label}
              <span className={`nx-tr-chip is-${a.status}`}>{a.status}</span>
            </div>
            <div className="nx-tr-acct__meta nx-type-data">
              {a.strategy} · {a.contracts} {a.contracts === 1 ? 'contract' : 'contracts'}
            </div>
            <div className="nx-tr-acct__buffer">
              <span className={`nx-tr-num is-${level}`}>{usd(a.buffer)}</span>
              <Meter share={share} level={level} />
            </div>
            <div className="nx-tr-acct__next nx-type-data">
              {a.status === 'eval' && a.target
                ? `${pct((a.balance - a.size) / (a.target - a.size))} to target`
                : a.status === 'funded'
                  ? `${a.consistency !== null ? `best day ${pct(a.consistency)} / ${pct(a.consistencyCap ?? 0)}` : ''}${
                      a.payoutInDays === null ? '' : a.payoutInDays === 0 ? ' · payout ready' : ` · payout in ${a.payoutInDays}d`
                    }`
                  : 'closed'}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function TradingStrategiesWidget({ ctx }: WidgetProps) {
  const s = useSnapshot(ctx)
  if (!s) return <Waiting />
  const live = s.strategies.filter((t) => t.stage === 'live')
  return (
    <div className="nx-tr-rows">
      {live.map((t) => {
        const peak = Math.max(1, ...t.regimes.map((r) => Math.abs(r.pnl)))
        return (
          <div key={t.id} className="nx-tr-strat">
            <div className="nx-tr-strat__head">
              <span className={`nx-tr-flag is-${t.flag}`} title={`Kill flag: ${t.flag}`} />
              <span className="nx-tr-strat__name">{t.name}</span>
              <span className="nx-tr-num">{pct(t.liveRatio)}</span>
            </div>
            <div className="nx-type-data nx-tr-strat__meta">
              {usd(t.livePerDay)}/day live vs {usd(t.expectedPerDay)} projected · drawdown {usd(t.drawdown)} of{' '}
              {usd(t.drawdownMc95)} (MC 95th) · {t.flagReason}
            </div>
            <div className="nx-tr-regimes">
              {t.regimes.map((r) => (
                <span key={r.regime} className="nx-tr-regime nx-type-data" title={`${r.regime}: ${usd(r.pnl, true)}`}>
                  <span className="nx-tr-regime__label">{r.regime}</span>
                  <Meter share={Math.abs(r.pnl) / peak} level={r.pnl >= 0 ? 'ok' : 'bad'} />
                </span>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function TradingPortfolioWidget({ ctx }: WidgetProps) {
  const s = useSnapshot(ctx)
  if (!s) return <Waiting />
  const p = s.portfolio
  const total = p.equity[p.equity.length - 1] ?? 0
  const ddShare = p.maxDrawdown / p.evalDrawdown
  return (
    <div className="nx-tr-portfolio">
      <div className="nx-tr-stats">
        <div>
          <span className="nx-type-label">Combined</span>
          <span className={`nx-tr-big ${total >= 0 ? 'is-ok' : 'is-bad'}`}>{usd(total, true)}</span>
        </div>
        <div>
          <span className="nx-type-label">Max drawdown</span>
          <span className={`nx-tr-big ${ddShare > 1 ? 'is-bad' : ddShare > 0.7 ? 'is-warn' : ''}`}>{usd(p.maxDrawdown)}</span>
          <span className="nx-type-data">vs {usd(p.evalDrawdown)}, one account&apos;s allowance</span>
        </div>
        {p.correlation.map((c) => (
          <div key={`${c.a}-${c.b}`}>
            <span className="nx-type-label">
              {c.a} × {c.b}
            </span>
            <span className={`nx-tr-big ${c.r > 0.5 ? 'is-bad' : c.r > 0.25 ? 'is-warn' : 'is-ok'}`}>{c.r.toFixed(2)}</span>
            <span className="nx-type-data">{c.r > 0.5 ? 'doubled risk' : c.r > 0.25 ? 'some overlap' : 'cushion each other'}</span>
          </div>
        ))}
      </div>
      <Curve values={p.equity} height={200} />
      <div className="nx-type-data nx-tr-axis">
        <span>{p.days[0]?.date}</span>
        <span>{p.days.length} trading days</span>
        <span>{p.days[p.days.length - 1]?.date}</span>
      </div>
    </div>
  )
}

export function TradingIncomeWidget({ ctx }: WidgetProps) {
  const s = useSnapshot(ctx)
  if (!s) return <Waiting />
  const i = s.income
  const peak = Math.max(i.threshold, ...i.months.map((m) => m.takeHome))
  return (
    <div className="nx-tr-income">
      <div className="nx-tr-stats">
        <div>
          <span className="nx-type-label">Pace (3 months)</span>
          <span className={`nx-tr-big ${i.projectedTakeHome >= i.threshold ? 'is-ok' : ''}`}>{usd(i.projectedTakeHome)}</span>
          <span className="nx-type-data">of {usd(i.threshold)} / month</span>
        </div>
        <div>
          <span className="nx-type-label">This month</span>
          <span className="nx-tr-big">{usd(i.takeHome)}</span>
          <span className="nx-type-data">from {usd(i.gross)} in payouts</span>
        </div>
      </div>
      <Meter share={i.projectedTakeHome / i.threshold} level={i.projectedTakeHome >= i.threshold ? 'ok' : 'plain'} />
      <div className="nx-tr-months">
        {i.months.map((m) => (
          <span key={m.month} className="nx-tr-month" title={`${m.month}: ${usd(m.takeHome)}`}>
            <span className="nx-tr-month__track">
              <span
                className={`nx-tr-month__bar ${m.takeHome >= i.threshold ? 'is-ok' : ''}`}
                style={{ height: `${(m.takeHome / peak) * 100}%` }}
              />
            </span>
            <span className="nx-type-data">{m.month.slice(5)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

export function TradingCapitalWidget({ ctx }: WidgetProps) {
  const s = useSnapshot(ctx)
  if (!s) return <Waiting />
  const c = s.capital
  return (
    <div className="nx-tr-capital">
      <div className="nx-tr-stats">
        <div>
          <span className="nx-type-label">Spent</span>
          <span className="nx-tr-big">{usd(c.evalSpend)}</span>
        </div>
        <div>
          <span className="nx-type-label">Paid out</span>
          <span className="nx-tr-big is-ok">{usd(c.payouts)}</span>
        </div>
        <div>
          <span className="nx-type-label">Return on evals</span>
          <span className="nx-tr-big">{c.evalSpend ? `${(c.payouts / c.evalSpend).toFixed(1)}×` : '—'}</span>
        </div>
      </div>
      <div className="nx-tr-ledger">
        {c.ledger.slice(0, 3).map((l, n) => (
          <div key={n} className="nx-tr-ledger__row nx-type-data">
            <span>{l.date.slice(5)}</span>
            <span className="nx-tr-ledger__note">
              {l.kind} · {l.note}
            </span>
            <span className={l.amount >= 0 ? 'is-ok' : ''}>{usd(l.amount, true)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TesterCard({ run }: { run: TesterRun }) {
  return (
    <div className="nx-tr-tester">
      <div className="nx-tr-tester__head">
        <span className="nx-tr-strat__name">{run.strategy}</span>
        <TradingSource real={run.real} />
      </div>
      <div className="nx-tr-stats nx-tr-stats--tight">
        <div>
          <span className="nx-type-label">Total P&amp;L</span>
          <span className={`nx-tr-big ${run.totalPnl >= 0 ? 'is-ok' : 'is-bad'}`}>
            {run.totalPnl >= 0 ? '+' : '−'}${Math.abs(run.totalPnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </span>
        </div>
        <div>
          <span className="nx-type-label">Max drawdown</span>
          <span className="nx-tr-big">${run.maxDrawdown.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
        </div>
        <div>
          <span className="nx-type-label">Profitable</span>
          <span className="nx-tr-big">
            {pct(run.wins / run.trades)} <span className="nx-type-data">{run.wins}/{run.trades}</span>
          </span>
        </div>
        <div>
          <span className="nx-type-label">Profit factor</span>
          <span className="nx-tr-big">{run.profitFactor.toFixed(3)}</span>
        </div>
      </div>
      <Curve values={[0, ...run.curve]} height={70} />
      <div className="nx-type-data nx-tr-axis">
        <span>{run.period}</span>
        <span>{run.note}</span>
      </div>
    </div>
  )
}

/** TradingView's strategy tester: what the signals did, before execution touched them. */
export function TradingTesterWidget({ ctx }: WidgetProps) {
  const s = useSnapshot(ctx)
  if (!s) return <Waiting />
  return (
    <div className="nx-tr-rows">
      {s.tester.map((run) => (
        <TesterCard key={run.strategy} run={run} />
      ))}
    </div>
  )
}

const STAGES: PipelineStage[] = ['idea', 'backtest', 'walk-forward', 'eval', 'live']

/** Idea → backtest → walk-forward → eval → live, and what sits in each. */
export function TradingPipelineWidget({ ctx }: WidgetProps) {
  const s = useSnapshot(ctx)
  if (!s) return <Waiting />
  return (
    <div className="nx-tr-pipeline">
      {STAGES.map((stage) => {
        const here = s.strategies.filter((t) => t.stage === stage)
        return (
          <div key={stage} className="nx-tr-stage">
            <span className="nx-type-label">{stage}</span>
            {here.length === 0 ? (
              <span className="nx-type-data nx-tr-stage__empty">—</span>
            ) : (
              here.map((t) => (
                <span key={t.id} className={`nx-tr-card ${t.stage === 'live' ? `is-${t.flag}` : ''}`}>
                  {t.name.replace(' (in development)', '')}
                </span>
              ))
            )}
          </div>
        )
      })}
    </div>
  )
}

/** The practice belts: reps, rule adherence, expectancy by setup. */
export function TradingPracticeWidget({ ctx }: WidgetProps) {
  const s = useSnapshot(ctx)
  if (!s) return <Waiting />
  const p = s.practice
  const peak = Math.max(1, ...p.bySetup.map((x) => Math.abs(x.expectancy)))
  return (
    <div className="nx-tr-practice">
      <div className="nx-tr-stats nx-tr-stats--tight">
        <div>
          <span className="nx-type-label">Belt</span>
          <span className="nx-tr-big">{p.belt}</span>
          <span className="nx-type-data">next: {p.nextBelt}</span>
        </div>
        <div>
          <span className="nx-type-label">To promotion</span>
          <span className="nx-tr-big">
            {p.trades}/{p.tradesToPromote}
          </span>
          {p.trades === 0 ? (
            <span className="nx-type-data">no graded trades yet</span>
          ) : (
            <span className={`nx-type-data ${p.adherence >= 0.95 ? '' : 'nx-tr-warn'}`}>
              rules kept {pct(p.adherence)} (needs 95%)
            </span>
          )}
        </div>
        <div>
          <span className="nx-type-label">This week</span>
          <span className="nx-tr-big">{p.repsThisWeek} reps</span>
          <span className="nx-tr-grades" title="Execution grade, last 10 sessions (1–3)">
            {p.grades.map((g, n) => (
              <span key={n} className={`nx-tr-grade is-${g}`} />
            ))}
          </span>
        </div>
      </div>
      <Meter share={p.trades / p.tradesToPromote} level="plain" />
      <div className="nx-tr-rows nx-tr-rows--tight">
        {p.bySetup.map((x) => (
          <div key={x.setup} className="nx-tr-setup nx-type-data">
            <span>{x.setup}</span>
            <Meter share={Math.abs(x.expectancy) / peak} level={x.expectancy >= 0 ? 'ok' : 'bad'} />
            <span className={x.expectancy >= 0 ? 'is-ok' : 'is-bad'}>{usd(x.expectancy, true)}/trade</span>
            <span>{x.trades}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The practice panel's real/mock tag: real once Kairos has written practice stats. */
export function TradingPracticeSource({ ctx }: { ctx: WidgetContext }) {
  const s = useSnapshot(ctx)
  return <TradingSource real={!!s?.real?.practice} />
}

// ------------------------------------------------------------------
// Practice sessions: each saved sim-lab session, its report, and its note.

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `${n < 0 ? '−' : n > 0 ? '+' : ''}$${Math.abs(n).toFixed(2)}`
const share = (n: number | null | undefined) => (n === null || n === undefined ? '—' : pct(n))
const fixed = (n: number | null | undefined, d = 1, unit = '') => (n === null || n === undefined ? '—' : `${n.toFixed(d)}${unit}`)
const replayDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const tone = (n: number | null | undefined) => (n === null || n === undefined || n === 0 ? '' : n > 0 ? 'is-ok' : 'is-bad')

function SessionReport({ ctx, id }: { ctx: WidgetContext; id: number }) {
  const [r, setR] = useState<PracticeSessionReport | null | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    void ctx.read.practiceSession(id).then((x) => !cancelled && setR(x))
    return () => {
      cancelled = true
    }
  }, [ctx.read, id])
  if (r === undefined) return <Waiting />
  if (r === null) return <div className="nx-home__hint nx-type-data">This session is no longer in trading.db.</div>
  const c = r.scorecard
  const stat = (label: string, value: string, cls = '') => (
    <div>
      <span className="nx-type-label">{label}</span>
      <span className={`nx-tr-num ${cls}`}>{value}</span>
    </div>
  )
  return (
    <div className="nx-tr-report">
      <div className="nx-tr-report__grid">
        {c.drill &&
          stat(
            c.drill.label,
            c.drill.value === null
              ? '—'
              : c.drill.label.includes('rate') || c.drill.label === 'adherence'
                ? pct(c.drill.value)
                : String(c.drill.value)
          )}
        {stat('adherence', share(c.adherence), (c.adherence ?? 1) < 0.95 ? 'is-warn' : '')}
        {stat('hold win / loss', `${fixed(c.hold_win_s, 1, 's')} / ${fixed(c.hold_loss_s, 1, 's')}`)}
        {stat('passive entries', share(c.passive_share))}
        {stat('slip in / out', `${fixed(c.entry_slip, 1, 't')} / ${fixed(c.exit_slip, 1, 't')}`)}
        {stat('chases', String(c.chases))}
        {stat('heat (MAE)', fixed(c.mae_ticks, 1, 't'))}
        {stat('move kept', share(c.mfe_capture))}
        {stat('fees', `$${c.fees.toFixed(2)}`)}
      </div>
      {r.tradeList.length > 0 && (
        <div className="nx-tr-report__trades nx-type-data">
          {r.tradeList.map((t) => (
            <div key={t.n} className="nx-tr-report__trade">
              <span>#{t.n}</span>
              <span className={t.side > 0 ? 'is-ok' : 'is-bad'}>{t.side > 0 ? 'long' : 'short'} {t.qty}</span>
              <span>{t.entryTime.slice(0, 8)}</span>
              <span>
                {t.avgEntry.toFixed(2)} → {t.avgExit.toFixed(2)}
              </span>
              <span className={tone(t.ticks)}>
                {t.ticks > 0 ? '+' : ''}
                {t.ticks.toFixed(1)}t
              </span>
              <span className={tone(t.netPnl)}>{money(t.netPnl)}</span>
              <span>{(t.holdMs / 1000).toFixed(1)}s</span>
              <span>{t.entryKind}</span>
              <span className="nx-tr-report__tag">
                {[t.setup, t.grade ? `g${t.grade}` : null].filter(Boolean).join(' · ')}
                {t.violations ? <span className="nx-tr-warn"> ⚠ {t.violations}</span> : null}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Saved sim-lab sessions, newest first: open the report, write or open the note. */
export function TradingSessionsWidget({ ctx }: WidgetProps) {
  const [rows, setRows] = useState<PracticeSessionSummary[] | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    void ctx.read.practiceSessions(12).then((x) => !cancelled && setRows(x))
    return () => {
      cancelled = true
    }
  }, [ctx.read])
  if (!rows) return <Waiting />
  if (!rows.length)
    return (
      <div className="nx-home__hint nx-type-data">
        No practice sessions yet. Sessions you finish in the Kairos sim lab appear here, ready for a note.
      </div>
    )
  const note = async (id: number) => {
    setBusy(id)
    try {
      await ctx.write.openPracticeNote(id)
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="nx-tr-rows nx-tr-rows--tight nx-tr-sessions">
      {rows.map((s) => (
        <div key={s.id} className={`nx-tr-session ${open === s.id ? 'is-open' : ''}`}>
          <div className="nx-tr-session__row">
            <button
              type="button"
              className="nx-tr-session__main"
              onClick={() => setOpen(open === s.id ? null : s.id)}
              aria-expanded={open === s.id}
              title="Show the report"
            >
              <span className="nx-tr-session__title" title={`Session ${s.id}: ${s.sessionDate} replayed from ${s.startTime.slice(0, 5)}`}>
                #{s.id} · {replayDay(s.sessionDate)}
              </span>
              <span
                className={`nx-tr-session__mode nx-type-data ${s.mode === 'graded' ? 'is-graded' : ''}`}
                title={`${s.mode}${s.drill ? `, ${DRILL_NAMES[s.drill] ?? s.drill}` : ', free session'}`}
              >
                {s.mode === 'graded' ? 'graded · ' : ''}
                {s.drill ? (DRILL_NAMES[s.drill] ?? s.drill) : 'free'}
              </span>
              <span className="nx-type-data" title="trades">{s.trades}×</span>
              <span className={`nx-tr-num ${tone(s.netPnl)}`}>{money(s.netPnl)}</span>
              <span className={`nx-type-data ${(s.adherence ?? 1) < 0.95 ? 'nx-tr-warn' : ''}`}>{share(s.adherence)}</span>
            </button>
            <button
              type="button"
              className={`nx-tr-session__note ${s.noteId ? 'has-note' : ''}`}
              disabled={busy === s.id}
              onClick={() => void note(s.id)}
            >
              {s.noteId ? 'Open note' : 'Write note'}
            </button>
          </div>
          {open === s.id && <SessionReport ctx={ctx} id={s.id} />}
        </div>
      ))}
    </div>
  )
}
