/**
 * The trading portfolio, as Nexus sees it (TRADING.md, "Nexus integration").
 *
 * Nexus only ever reads this. The real source is `trading.db`, which Python
 * writes and Nexus opens read-only; until it exists, `simulateTrading` makes a
 * stand-in with the same shape, so the Trading page can be designed and lived
 * with before there is a ledger behind it. Every panel says which it is
 * showing (`source`), and swapping mock for real changes nothing outside the
 * main process.
 *
 * The figures are invented. The arithmetic is not: accounts trail their
 * drawdown on the close and lock at the starting balance, evals pass at their
 * target, a balance at the floor blows the account, and take-home is gross
 * less the prop split and the tax set-aside.
 */

export type AccountStatus = 'eval' | 'funded' | 'blown'
export type KillFlag = 'green' | 'amber' | 'red'
export type PipelineStage = 'idea' | 'backtest' | 'walk-forward' | 'eval' | 'live'

export interface TradingAccount {
  id: string
  firm: string
  label: string
  size: number
  status: AccountStatus
  strategy: string
  contracts: number
  balance: number
  /** Where a close below ends the account. */
  floor: number
  /** balance − floor: the number that matters most. */
  buffer: number
  /** The drawdown allowance, for drawing the buffer as a share of it. */
  drawdown: number
  /** Eval only: the balance that passes it. */
  target: number | null
  /** Funded only: best day's share of total profit, against the firm's cap. */
  consistency: number | null
  consistencyCap: number | null
  /** Funded only: days until a payout can be asked for; 0 = eligible now. */
  payoutInDays: number | null
  lastFill: string
  /** The last 30 closes, for a sparkline. */
  curve: number[]
}

export interface TradingStrategy {
  id: string
  name: string
  stage: PipelineStage
  /** Projected $/day per contract from the backtest. */
  expectedPerDay: number
  /** Realised $/day per contract, live. */
  livePerDay: number
  /** livePerDay ÷ expectedPerDay. */
  liveRatio: number
  /** Live drawdown against the Monte Carlo 95th percentile. */
  drawdown: number
  drawdownMc95: number
  flag: KillFlag
  /** Plain words for the flag. */
  flagReason: string
  /** Where it earns: P&L by regime over the window. */
  regimes: { regime: string; pnl: number }[]
}

/**
 * A strategy's run in TradingView's strategy tester — the signals side of the
 * ledger (TRADING.md: "Export the trade list from TradingView's strategy
 * tester"). Unlike everything else here, the first of these is real: entered
 * by hand from the tester's Key stats.
 */
export interface TesterRun {
  strategy: string
  period: string
  totalPnl: number
  totalPnlPct: number
  maxDrawdown: number
  maxDrawdownPct: number
  wins: number
  trades: number
  profitFactor: number
  /** Cumulative P&L after each trade. */
  curve: number[]
  /** Where the figures came from. */
  note: string
  real: boolean
}

export interface TradingSnapshot {
  source: 'mock' | 'trading.db'
  asOf: string
  /** Days since the last import; past 2 it is drawn as stale. */
  importAgeDays: number
  accounts: TradingAccount[]
  strategies: TradingStrategy[]
  portfolio: {
    /** Combined daily P&L, oldest first. */
    days: { date: string; pnl: number }[]
    /** Running sum of `days`. */
    equity: number[]
    maxDrawdown: number
    /** The tightest account drawdown the combined curve has to live inside. */
    evalDrawdown: number
    /** Correlation of daily P&L between strategy pairs. */
    correlation: { a: string; b: string; r: number }[]
  }
  income: {
    threshold: number
    /** This month so far. */
    gross: number
    takeHome: number
    projectedTakeHome: number
    /** Last six months' take-home, oldest first. */
    months: { month: string; takeHome: number }[]
  }
  capital: {
    evalSpend: number
    payouts: number
    ledger: { date: string; kind: 'eval' | 'reset' | 'data' | 'payout'; amount: number; note: string }[]
  }
  practice: {
    belt: string
    nextBelt: string
    trades: number
    tradesToPromote: number
    adherence: number
    repsThisWeek: number
    bySetup: { setup: string; trades: number; expectancy: number }[]
    /** Execution grades 1–3, last 10 sessions. */
    grades: number[]
  }
  tester: TesterRun[]
  execution: {
    /** Share of signals that filled. */
    fillRate: number
    /** Average slippage in points on filled limit entries. */
    slippage: number
  }
}

// ------------------------------------------------------------------
// The simulation
// ------------------------------------------------------------------

/** A small seeded generator, so the mock is the same every time it is drawn. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function normal(r: () => number): number {
  const u = Math.max(r(), 1e-9)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r())
}

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Weekdays, oldest first, ending on or before `today`. */
function tradingDays(today: string, count: number): string[] {
  const out: string[] = []
  const d = new Date(`${today}T12:00:00`)
  while (out.length < count) {
    if (d.getDay() !== 0 && d.getDay() !== 6) out.unshift(isoDay(d))
    d.setDate(d.getDate() - 1)
  }
  return out
}

function correlation(a: number[], b: number[]): number {
  const n = a.length
  const ma = a.reduce((s, x) => s + x, 0) / n
  const mb = b.reduce((s, x) => s + x, 0) / n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db += (b[i] - mb) ** 2
  }
  return da && db ? num / Math.sqrt(da * db) : 0
}

const round = (n: number) => Math.round(n)

/**
 * A stand-in for `trading.db`: 120 trading days of three strategies, five
 * accounts across three firms, and the month's money. Deterministic.
 */
export function simulateTrading(today: string): TradingSnapshot {
  const r = rng(20261009)
  const days = tradingDays(today, 120)
  const regimeOf = days.map(() => {
    const x = r()
    return x < 0.35 ? 'trend' : x < 0.75 ? 'chop' : 'high vol'
  })

  // Per-contract daily P&L. Strat 1 earns in chop, strat 2 in trend; a shared
  // market factor gives them a little correlation, as real ones would have.
  const specs = [
    { id: 's1', name: 'KAIROS · NQ mean reversion', stage: 'live' as const, expected: 150, live: 0.86, edge: { trend: -110, chop: 110, 'high vol': 0 }, sd: 260 },
    { id: 's2', name: 'Strat 2 · VWAP fade', stage: 'live' as const, expected: 115, live: 0.74, edge: { trend: 120, chop: -70, 'high vol': -60 }, sd: 220 },
    { id: 's3', name: 'Strat 3 · open drive', stage: 'walk-forward' as const, expected: 120, live: 0, edge: { trend: 60, chop: 0, 'high vol': 90 }, sd: 260 },
    { id: 's4', name: 'Strat 4 · overnight gap (in development)', stage: 'backtest' as const, expected: 90, live: 0, edge: { trend: 0, chop: 0, 'high vol': 0 }, sd: 240 }
  ]
  const market = days.map(() => normal(r))
  const pnl: Record<string, number[]> = {}
  for (const s of specs) {
    if (s.stage !== 'live') continue
    pnl[s.id] = days.map((_, i) => {
      const base = s.expected * s.live + s.edge[regimeOf[i] as keyof typeof s.edge]
      return base + s.sd * (0.35 * market[i] + 0.94 * normal(r))
    })
  }

  // ---- accounts: EOD trailing drawdown, locked at the starting balance
  const accountSpecs = [
    { id: 'a1', firm: 'Apex', label: 'Apex 50k · A', size: 50_000, dd: 2_000, strategy: 's1', contracts: 1, start: 0, eval: false, cap: 0.3 },
    { id: 'a2', firm: 'Apex', label: 'Apex 50k · B', size: 50_000, dd: 2_000, strategy: 's1', contracts: 1, start: 70, eval: true, cap: 0.3 },
    { id: 'a3', firm: 'Topstep', label: 'Topstep 50k', size: 50_000, dd: 2_000, strategy: 's2', contracts: 1, start: 30, eval: false, cap: 0.5 },
    { id: 'a4', firm: 'Topstep', label: 'Topstep 50k · eval', size: 50_000, dd: 2_000, strategy: 's2', contracts: 1, start: 104, eval: true, cap: 0.5 },
    { id: 'a5', firm: 'TPT', label: 'TPT 50k', size: 50_000, dd: 2_000, strategy: 's1', contracts: 1, start: 60, eval: true, cap: 0.4 }
  ]
  // Payouts taken along the way: once a funded account is $3,000 up, $2,000
  // comes out — which is what keeps a real buffer from growing for ever.
  const payouts: { date: string; amount: number; note: string }[] = []
  const accounts: TradingAccount[] = accountSpecs.map((a) => {
    let balance = a.size
    let hwm = a.size
    let status: AccountStatus = a.eval ? 'eval' : 'funded'
    let floor = a.size - a.dd
    const closes: number[] = []
    const daily: number[] = []
    for (let i = a.start; i < days.length; i++) {
      if (status === 'blown') break
      const day = pnl[a.strategy][i] * a.contracts
      balance += day
      daily.push(day)
      hwm = Math.max(hwm, balance)
      floor = Math.min(hwm - a.dd, a.size)
      if (status === 'funded' && balance - a.size >= 3_000) {
        balance -= 2_000
        payouts.push({ date: days[i], amount: 2_000 * 0.9, note: a.label })
      }
      closes.push(balance)
      if (balance <= floor) status = 'blown'
      if (status === 'eval' && balance >= a.size + 3_000) {
        // A passed eval becomes a funded account at the starting balance.
        status = 'funded'
        balance = a.size
        hwm = a.size
        floor = a.size - a.dd
      }
    }
    // Consistency is over everything the account has made, payouts included.
    const profit = daily.reduce((n, x) => n + x, 0)
    const best = Math.max(0, ...daily)
    return {
      id: a.id,
      firm: a.firm,
      label: a.label,
      size: a.size,
      status,
      strategy: specs.find((s) => s.id === a.strategy)!.name.split(' · ')[0],
      contracts: a.contracts,
      balance: round(balance),
      floor: round(floor),
      buffer: round(Math.max(0, balance - floor)),
      drawdown: a.dd,
      target: status === 'eval' ? a.size + 3_000 : null,
      consistency: status === 'funded' && profit > 0 ? Math.min(1, best / profit) : null,
      consistencyCap: status === 'funded' ? a.cap : null,
      payoutInDays:
        status === 'funded' && balance - a.size > 1_000 ? Math.max(0, 8 - ((days.length - a.start) % 9)) : null,
      lastFill: days[days.length - 4],
      curve: closes.slice(-30).map(round)
    }
  })

  // ---- strategies
  const strategies: TradingStrategy[] = specs.map((s) => {
    const series = pnl[s.id]
    const livePerDay = series ? series.reduce((n, x) => n + x, 0) / series.length : 0
    let peak = 0
    let run = 0
    let dd = 0
    for (const x of series ?? []) {
      run += x
      peak = Math.max(peak, run)
      dd = Math.max(dd, peak - run)
    }
    const ratio = series ? livePerDay / s.expected : 0
    const mc95 = s.sd * 7
    const flag: KillFlag = !series ? 'green' : ratio < 0.6 || dd > mc95 ? 'red' : ratio < 0.8 || dd > mc95 * 0.8 ? 'amber' : 'green'
    const regimes = ['trend', 'chop', 'high vol'].map((regime) => ({
      regime,
      pnl: round((series ?? []).reduce((n, x, i) => n + (regimeOf[i] === regime ? x : 0), 0))
    }))
    return {
      id: s.id,
      name: s.name,
      stage: s.stage,
      expectedPerDay: s.expected,
      livePerDay: round(livePerDay),
      liveRatio: ratio,
      drawdown: round(dd),
      drawdownMc95: round(mc95),
      flag,
      flagReason: !series
        ? 'not live yet'
        : flag === 'red'
          ? 'past its kill criteria: pause and review'
          : flag === 'amber'
            ? `running at ${Math.round(ratio * 100)}% of projection`
            : 'inside expectations',
      regimes
    }
  })

  // ---- portfolio: what the live accounts made, combined
  const combined = days.map((date, i) => ({
    date,
    pnl: round(
      accountSpecs.reduce((n, a) => {
        const acc = accounts.find((x) => x.id === a.id)!
        return i >= a.start && acc.status !== 'blown' ? n + pnl[a.strategy][i] * a.contracts : n
      }, 0)
    )
  }))
  const equity: number[] = []
  let sum = 0
  let peak = 0
  let maxDrawdown = 0
  for (const d of combined) {
    sum += d.pnl
    equity.push(sum)
    peak = Math.max(peak, sum)
    maxDrawdown = Math.max(maxDrawdown, peak - sum)
  }

  // ---- income: this month, at the prop split and the tax set-aside
  // Income is payouts — money that actually left the firms, already past the
  // 10% split — less the 40% set aside for tax and savings.
  const month = today.slice(0, 7)
  const takeHome = (g: number) => round(g * 0.6)
  const grossIn = (m: string) => payouts.filter((p) => p.date.startsWith(m)).reduce((n, p) => n + p.amount, 0)
  const gross = round(grossIn(month))
  const months = [5, 4, 3, 2, 1, 0].map((back) => {
    const d = new Date(`${today}T12:00:00`)
    d.setDate(1)
    d.setMonth(d.getMonth() - back)
    const m = isoDay(d).slice(0, 7)
    return { month: m, takeHome: takeHome(Math.max(0, grossIn(m))) }
  })

  return {
    source: 'mock',
    asOf: today,
    importAgeDays: 3,
    accounts,
    strategies,
    portfolio: {
      days: combined,
      equity,
      maxDrawdown: round(maxDrawdown),
      evalDrawdown: 2_000,
      correlation: [{ a: 'KAIROS', b: 'Strat 2', r: correlation(pnl.s1, pnl.s2) }]
    },
    income: {
      threshold: 6_000,
      gross: round(gross),
      takeHome: takeHome(gross),
      // The last three full months' pace, since payouts land in lumps.
      projectedTakeHome: round(months.slice(2, 5).reduce((n, m) => n + m.takeHome, 0) / 3),
      months
    },
    capital: (() => {
      const spend = [
        { date: days[0], kind: 'eval' as const, amount: -167, note: 'Apex 50k · A' },
        { date: days[12], kind: 'data' as const, amount: -139, note: 'Databento' },
        { date: days[30], kind: 'eval' as const, amount: -165, note: 'Topstep 50k' },
        { date: days[48], kind: 'reset' as const, amount: -99, note: 'Apex reset' },
        { date: days[60], kind: 'eval' as const, amount: -167, note: 'TPT 50k' },
        { date: days[70], kind: 'eval' as const, amount: -167, note: 'Apex 50k · B' },
        { date: days[82], kind: 'data' as const, amount: -139, note: 'Databento' },
        { date: days[104], kind: 'eval' as const, amount: -165, note: 'Topstep 50k · eval' }
      ]
      const ledger = [
        ...spend,
        ...payouts.map((p) => ({ date: p.date, kind: 'payout' as const, amount: round(p.amount), note: p.note }))
      ].sort((x, y) => y.date.localeCompare(x.date))
      return {
        evalSpend: -spend.reduce((n, x) => n + x.amount, 0),
        payouts: round(payouts.reduce((n, p) => n + p.amount, 0)),
        ledger
      }
    })(),
    practice: {
      belt: 'Live sim',
      nextBelt: 'Live micros',
      trades: 64,
      tradesToPromote: 100,
      adherence: 0.93,
      repsThisWeek: 9,
      bySetup: [
        { setup: 'Open drive', trades: 22, expectancy: 38 },
        { setup: 'VWAP reclaim', trades: 18, expectancy: 21 },
        { setup: 'Level fade', trades: 15, expectancy: -6 },
        { setup: 'Runner hold', trades: 9, expectancy: 54 }
      ],
      grades: [2, 1, 2, 2, 3, 2, 2, 3, 3, 2]
    },
    tester: [
      {
        strategy: 'KAIROS · NQ mean reversion',
        period: '2 Sep – 9 Oct 2026',
        totalPnl: 2926.48,
        totalPnlPct: 0.29,
        maxDrawdown: 996.49,
        maxDrawdownPct: 0.1,
        wins: 10,
        trades: 28,
        profitFactor: 2.153,
        // Traced by eye from the tester's cumulative P&L chart; the end point is exact.
        curve: [
          -245, -390, -545, -700, -870, -830, -560, -700, -640, 820, 700, 1120, 1000, 870, 1170, 1050, 900, 790,
          660, 1650, 1540, 3000, 2880, 2760, 2790, 3150, 3030, 2926.48
        ],
        note: 'TradingView strategy tester, entered by hand 9 Oct',
        real: true
      },
      (() => {
        // Strat 4's backtest so far: a mock of what a strategy in development looks like.
        const t = rng(4)
        let run = 0
        const curve = Array.from({ length: 40 }, () => (run += t() < 0.46 ? 150 + t() * 220 : -(90 + t() * 120)))
        return {
          strategy: 'Strat 4 · overnight gap',
          period: 'backtest, 2023–2026 (mock)',
          totalPnl: round(run),
          totalPnlPct: 0,
          maxDrawdown: 640,
          maxDrawdownPct: 0,
          wins: 18,
          trades: 40,
          profitFactor: 1.62,
          curve: curve.map(round),
          note: 'In development: mock',
          real: false
        }
      })()
    ],
    execution: { fillRate: 0.87, slippage: 0.75 }
  }
}
