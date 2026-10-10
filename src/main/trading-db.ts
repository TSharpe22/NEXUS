import Database from 'better-sqlite3'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type {
  PracticeSessionReport,
  PracticeSessionSummary,
  PracticeTrade,
  TradingSnapshot
} from '@shared/trading'

/**
 * `trading.db`, read-only (TRADING.md, "Nexus integration").
 *
 * Kairos writes the file; Nexus only ever opens it with `readonly`, so a bug
 * here cannot touch trade data and a Nexus rebuild cannot either. Nothing is
 * recomputed on this side: the numbers are the ones Kairos stored — the
 * scorecard in `sim_session_report`, the belt gate in `sim_stats`.
 *
 * Opened per call and closed again: reads are rare (a page load), and an
 * open handle would keep Kairos's WAL from checkpointing.
 */

/** The schema this reader understands. Kairos's migration 3 added what it reads. */
const MIN_SCHEMA = 3

export function ledgerPath(): string {
  return process.env.TRADING_DB || join(homedir(), 'Trading', 'trading.db')
}

function withLedger<T>(read: (db: Database.Database) => T): T | null {
  const path = ledgerPath()
  if (!existsSync(path)) return null
  let db: Database.Database | null = null
  try {
    db = new Database(path, { readonly: true, fileMustExist: true })
    const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined
    if (!row || Number(row.value) < MIN_SCHEMA) return null
    return read(db)
  } catch (e) {
    console.warn('[trading.db] could not read the ledger:', e)
    return null
  } finally {
    db?.close()
  }
}

interface PracticeStatsJson {
  belt: string
  next_belt: string
  graded: { trades: number; adherence: number | null }
  graded_sessions_this_week: number
  gate_trades: number
  by_setup: { setup: string; trades: number; expectancy: number | null }[]
  grades: number[]
}

/** The practice panel's numbers, or null when the ledger has none yet. */
export function ledgerPractice(): TradingSnapshot['practice'] | null {
  return withLedger((db) => {
    const row = db.prepare("SELECT json FROM sim_stats WHERE key = 'practice'").get() as { json: string } | undefined
    if (!row) return null
    const st = JSON.parse(row.json) as PracticeStatsJson
    const belts = ['Replay', 'Live sim', 'Live micros', 'Minis']
    return {
      belt: st.belt,
      nextBelt: st.next_belt ?? belts[belts.indexOf(st.belt) + 1] ?? '',
      trades: st.graded.trades,
      tradesToPromote: st.gate_trades,
      adherence: st.graded.adherence ?? 0,
      repsThisWeek: st.graded_sessions_this_week,
      bySetup: st.by_setup.map((x) => ({ setup: x.setup, trades: x.trades, expectancy: x.expectancy ?? 0 })),
      grades: st.grades
    }
  })
}

interface ReportRow {
  id: number
  started_at: string
  session_date: string
  symbol: string
  mode: 'practice' | 'graded'
  drill: string | null
  ended: 'time' | 'lockout' | 'early'
  contract: string
  start_time: string
  stopped_at: string
  regime_shape: string | null
  regime_vol: string | null
  dll: number | null
  net_pnl: number
  trades: number | null
  expectancy: number | null
  win_rate: number | null
  adherence: number | null
  scorecard_json: string
}

function summary(r: ReportRow): PracticeSessionSummary {
  const regime = [r.regime_shape, r.regime_vol && `${r.regime_vol} vol`].filter(Boolean).join(', ')
  return {
    id: r.id,
    startedAt: r.started_at,
    sessionDate: r.session_date,
    symbol: r.symbol,
    mode: r.mode,
    drill: r.drill,
    ended: r.ended,
    contract: r.contract,
    startTime: r.start_time,
    stoppedAt: r.stopped_at,
    regime: regime || null,
    trades: r.trades ?? 0,
    netPnl: r.net_pnl,
    expectancy: r.expectancy,
    winRate: r.win_rate,
    adherence: r.adherence,
    noteId: null
  }
}

/** Saved sessions, newest first. Empty when there is no ledger. */
export function ledgerSessions(limit = 20): PracticeSessionSummary[] {
  return (
    withLedger((db) =>
      (db.prepare('SELECT * FROM sim_session_report ORDER BY id DESC LIMIT ?').all(limit) as ReportRow[]).map(summary)
    ) ?? []
  )
}

interface TradeRow {
  trip_no: number
  side: 1 | -1
  qty: number
  entry_time: string
  exit_time: string
  avg_entry: number
  avg_exit: number
  ticks: number
  net_pnl: number
  fees: number
  hold_ms: number
  mae_ticks: number
  mfe_ticks: number
  entry_kind: 'passive' | 'aggressive'
  entry_slip: number | null
  exit_slip: number | null
  exit_label: string
  violations: string
  setup: string | null
  grade: number | null
}

/** One session's full report, or null if it isn't in the ledger. */
export function ledgerSession(id: number): PracticeSessionReport | null {
  return withLedger((db) => {
    const r = db.prepare('SELECT * FROM sim_session_report WHERE id = ?').get(id) as ReportRow | undefined
    if (!r) return null
    const trades = db
      .prepare('SELECT * FROM sim_trades WHERE session_id = ? ORDER BY trip_no')
      .all(id) as TradeRow[]
    const tradeList: PracticeTrade[] = trades.map((t) => ({
      n: t.trip_no,
      side: t.side,
      qty: t.qty,
      entryTime: t.entry_time,
      exitTime: t.exit_time,
      avgEntry: t.avg_entry,
      avgExit: t.avg_exit,
      ticks: t.ticks,
      netPnl: t.net_pnl,
      fees: t.fees,
      holdMs: t.hold_ms,
      maeTicks: t.mae_ticks,
      mfeTicks: t.mfe_ticks,
      entryKind: t.entry_kind,
      entrySlip: t.entry_slip,
      exitSlip: t.exit_slip,
      exitLabel: t.exit_label,
      violations: t.violations,
      setup: t.setup,
      grade: t.grade
    }))
    return { ...summary(r), dll: r.dll, scorecard: JSON.parse(r.scorecard_json), tradeList }
  })
}
