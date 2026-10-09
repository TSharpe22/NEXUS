# TRADING — the trading portfolio and how it integrates with Nexus

> Planning reference from a conversation on 2026-10-08. **Not a phase
> document.** It records the direction for the trading portfolio, the data
> layer behind it (`trading.db`), the practice sim, and what Nexus should and
> should not do with trading data. Nothing here is scheduled; when the Nexus
> side is built it gets its own spec and slots into `PHASES.md` like any other
> work.
>
> Related: KAIROS (the Python NQ strategy, backtester and Flask UI) lives
> outside this repo. All trading logic stays there.

---

## Where things stand

- **Strat 1 (KAIROS, NQ mean-reversion):** live, running at **78–93% of its
  backtest projection**, mostly due to the execution layer (TradingView →
  PickMyTrade → Tradovate).
- **Strat 2:** working; expect live at a similar ratio to its projection.
- **Constraint:** money. Build what costs time now; spend the first payouts on
  more evals.
- **Income threshold:** a set monthly take-home figure triggers going part-time
  at the day job (`$THRESHOLD`).

## Why a portfolio

- Prop rules (EOD trailing drawdown, consistency %) end accounts on bad
  streaks, not bad edges. Uncorrelated strats on one curve mean fewer blown
  accounts per eval dollar.
- Every edge decays. One strat dying is a 100% income cut; one of four is 25%.
- **Same strat × N accounts is one bet made N times.** Account count multiplies
  income; strategy count protects it.
- Target: strats that fail at different times — long-reliant, short-reliant,
  chop vs. trend, later other instruments.

### Portfolio backtester (first build — free)

1. Daily P&L per strat from backtest trade logs.
2. Sum by date → combined equity curve.
3. Correlation of the daily P&L columns (near +1 = doubled risk; ~0 or
   negative = one cushions the other).
4. Max drawdown of the combined curve vs. the eval's trailing drawdown.
5. Tag each historical day by regime (trend/chop, vol high/low, up/down). Map
   which strat earns where; the gaps define strat 3.

## Scaling: what limits it

**Across accounts**
- Firm caps on funded accounts per person/household → spread across firms.
- Copy-trading rules differ per firm (within-firm only, cross-firm bans,
  "group trading", no opposite positions across accounts). Breaking them voids
  payouts. Re-check rules; they change.
- Correlation: same strat on 10 accounts can blow 10 accounts in one week.
- Execution fan-out: one signal to many accounts arrives in sequence; limit
  entries at VWAP fill on some accounts and miss on others.
- Eval cost/time, payout caps, consistency rules cap withdrawal speed.

**Across contract size**
- Per-account contract caps and firm scaling plans.
- Drawdown is fixed in dollars: 2× contracts = half the survivable losing
  streak. Risk of ruin grows faster than income.
- Use **micros (MNQ, $2/pt)** for fine-grained sizing instead of whole minis
  ($20/pt).
- Fill rate on limit entries degrades with size — watch it.

**Rule:** scale accounts before contracts. Size so the strat's Monte Carlo
95th-percentile drawdown uses ≤ ~50% of the buffer.

### Doubling contracts on a grown account

EOD trailing drawdown follows the balance up until it **locks** (typically at
the starting balance). Only profit above the lock widens the buffer.

| Balance ($50k acct, $2k EOD trailing) | Floor | Buffer |
|---|---|---|
| $50,000 (start) | $48,000 | $2,000 |
| $52,000 | $50,000 (locks) | $2,000 |
| $54,000 | $50,000 | **$4,000** → 2 contracts at 1-contract risk |

- Build-up: +$4k of profit with no withdrawals; time depends on the strat's
  monthly P&L.
- Withdrawals below $54k shrink the cushion; giving back profit doubles risk.
- **Dynamic sizing rule:** contracts = floor(buffer ÷ $2,000), recalculated
  daily. Step down with micros instead of halving.
- Verify each firm's exact lock level.

### Income math (illustrative, not a forecast)

Kept out of this public repo; the real figures live in Nexus. The method:

1. Live ratio = realistic live ÷ projected, per strat (strat 1: 78–93%).
2. Apply that ratio to each strat's projection.
3. × accounts per strat; sum across strats → gross.
4. − 10% prop split, − 40% taxes/savings → take-home.
5. 2 contracts after build-up ≈ 2× take-home at unchanged risk.

Not included: blown accounts, payout caps, consistency limits, buffer
requirements, eval/reset costs, correlation between copies. Plan around
**50–70% of projected gross** until measured.

## Operating rules to write before the money

- **Kill criteria per strat** (e.g. live drawdown beyond Monte Carlo 95th
  percentile, win rate X σ below expected) → pause and review.
- **Payout allocation:** fixed split for buffer / new evals / taxes (~25–30%
  set aside; payouts are self-employment income — confirm with a tax pro).
- **Firm rules audit:** automation, copy trading, max accounts, hedging.
- **Strategy pipeline:** one interface (signals in, orders out), a config per
  strat, the same walk-forward + Monte Carlo gate. New strats are plug-ins.

## Manual trading

Grows alongside the automated portfolio. **Only risk is strict; everything
else stays loose** — carefree, music on, no anxiety.

- Risk enforced by the platform (Tradovate risk settings: daily loss limit,
  max contracts, stop always placed, hard stop time), never by willpower.
- Separate accounts from anything copying automated strats.
- No journaling chore: manual fills are imported and tagged `manual`.
- One scoreboard, checked monthly: expectancy over the last 50–100 trades.
- Funded from a fixed slice of automated payouts (e.g. 10%).
- Watch the house-money effect: caps never relax on a good month.
- Manual is also research: repeated winning patterns become strategy candidates.

### Skill through practice (like sparring)

- Deliberate reps: drills on one skill per block (the open, entries at levels,
  cutting losers, holding runners), 2–3 replayed opens daily.
- Grade execution 1–3, not P&L.
- **Belts, gated by stats:** replay → live sim → live micros → minis. Promote
  at 100+ trades, positive expectancy, ≥95% rule adherence.
- **15 contracts appropriately:** 15 minis × 20-pt stop ≈ $6,000 risk → at
  1–2% per trade needs a ~$300–600k account. Large size is the end of capital
  growth plus stats, not a separate skill.

---

## The data layer: `trading.db`

One SQLite file — the single ledger every part of trading writes to. **Python
writes; Nexus only reads.** Every trade carries a `mode`: `auto`, `manual`,
`sim`.

**Raw tables (facts, never edited)**
- `accounts` — firm, size, starting balance, status (eval/funded/blown), start
  date, rule set.
- `firm_rules` — drawdown amount and type (EOD trailing / intraday / static),
  lock level, consistency %, profit target, min days, payout rules, commission
  per contract.
- `fills` — account, strategy, mode, time, side, qty, price, fees, fill ID.
- `signals` — what TradingView intended; matched to fills for slippage and
  missed trades.
- `payouts` / `expenses` — money out; eval fees, resets, data costs in.

**Computed tables (rebuilt by Python any time)**
- `daily_account` — balance, high-water mark, drawdown floor, buffer,
  consistency %, payout eligibility.
- `analytics` — correlation, combined drawdown, Monte Carlo, projections,
  kill-criteria flags.
- practice stats from `sim` trades.

A logic bug is fixed by rerunning the script, not by repairing data.

### Getting data in (free route)

1. Export fills CSV from each Tradovate-connected account (weekly).
2. Export the trade list from TradingView's strategy tester (signals).
3. Account state: calculated from fills + starting balance + firm rules.
4. Import script: reads a drop folder, normalizes, dedupes by fill ID, writes
   to SQLite. Routine: export → drop → run.

### Replicating firm dashboards

Balance, P&L, trailing floor, buffer, consistency % and target progress can all
be calculated. Catches: fees must be exact; rule details (EOD time, trail on
close vs. peak, lock level, payouts reducing balance) must be exact; intraday
open-position P&L isn't in exports. **The firm's number is the authority.**
Weekly: enter each firm's dashboard balance; Python flags any gap over a few
dollars.

---

## The practice sim

A Python replay engine over the Databento NQ data already owned.

- Replays a session at 1×/2×/5×; picks a **random, hidden date**.
- Drill mode: start at a chosen time (e.g. 9:30 open); filter by regime using
  the portfolio analysis's regime tags.
- Hotkeys to buy/sell/flatten; fills from KAIROS's fill model.
- Same strict risk rules as live, enforced by the engine.
- Every rep → `trading.db` with `mode = sim`, setup tag, execution grade,
  hidden session date, speed.

---

## Nexus integration

Nexus opens `trading.db` **read-only** (better-sqlite3 in the main process)
alongside its own database. Python owns the trading math; Nexus never
duplicates it. A Nexus bug can't corrupt trade data; a Nexus rebuild can't
touch it.

**Flow:** exports → import script → `trading.db` ← sim, analytics → Nexus
(read-only display).

### What Nexus should present

The test for any widget: *if this number changed, would I act differently?*
If not, it belongs in a note.

- **Live (automated):** per account — status, **drawdown buffer** (most
  important number), consistency %, distance to payout. Per strat — live vs.
  expected, kill flag (green/amber/red), regime behavior. Portfolio — combined
  equity, correlation, combined drawdown, income actual vs. projected,
  progress to `$THRESHOLD`.
- **Manual:** monthly expectancy, rule adherence.
- **Practice:** reps today/week, expectancy by setup, execution grade trend,
  current belt and progress to the next gate.
- **Capital:** eval spend vs. payouts (ROI on evals), payout allocation ledger.
- **Operations:** data freshness ("last import 3 days ago" in red), last fill
  per account, execution gap.
- **Projects:** strategy pipeline (idea → backtest → walk-forward → eval →
  live), next action per project.
- **Research loop:** a setup winning in sim and manual gets flagged as a
  strategy candidate, linked to its note.

### What Nexus can do
- Display anything in `trading.db`: tables, charts, history, filters.
- Show Python-computed flags (stale data, kill hit, payout eligible) on open.
- Link numbers to notes: strategy row → spec; firm row → rule sheet.
- Launch the sim (practice can't touch real money).

### What Nexus cannot / must not do
- **Live state:** only as fresh as the last import; real-time needs a paid feed.
- **Control trading:** no placing or flattening orders, ever. Dashboard and
  execution stay separate.
- **Read firm dashboards:** no API; balances are calculated or entered.
- **Analytics:** Python computes; duplicating math in TypeScript creates two
  truths.
- **Guarantee rule accuracy:** only as current as the recorded rules.

### Notes that live in Nexus as ordinary objects
- One per strategy: rules, expected stats, kill criteria.
- One per firm: rules, payout schedule, automation/copy-trade policy.
- Operating rules: payout split, scaling sequence, sizing rule.
- Weekly review template.

### Charts
TradingView Lightweight Charts (free, fits the aesthetic) or Recharts
(simpler).

---

## Build order

1. `trading.db` schema + import script (needs one scrubbed Tradovate fills
   CSV to design around).
2. Portfolio backtester (correlation, combined drawdown, regime map).
3. Account state calculation + weekly reconciliation.
4. Projections (Monte Carlo of monthly income by account count).
5. Practice sim.
6. Nexus trading view — its own spec, sequenced in `PHASES.md` when the
   structural phases it depends on are done.

## Rough timeline (illustrative)

- **Q4 2026:** pass evals, first payouts, items 1–3.
- **Q1–Q2 2027:** reinvest in evals across firms, strat 2 live, research
  strat 3, sim.
- **Q3–Q4 2027:** reach `$THRESHOLD`, expense buffer, part-time at the day job,
  small personal account funded only from payouts.
