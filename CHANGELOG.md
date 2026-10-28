# Changelog

All notable changes are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); entries reference `PLAN.md` task IDs.

## [Unreleased]

### Login & wallet (ADR-0020)

#### Added

- SIWE sign-in (M6-01):
  - `GET /api/auth/nonce` issues a single-use nonce (5-minute TTL in Valkey).
  - `POST /api/auth/siwe` checks domain, URI, chain id and message age, burns the nonce, and verifies the signature: ECDSA, or EOA/ERC-1271/6492 when `BASE_SEPOLIA_RPC_URL` is set.
  - It then sets the session cookie. The account id is the lower-case address.
  - `POST /api/auth/logout`.
  - In `DATA_TIER=sim`, a new wallet account gets the one-time play-money credit until on-chain deposits exist.

### M4 — Full engine (in progress, on `integration/m4`)

#### Added

- Hourly funding (ADR-0016) on event time:
  - The rate is interest (500 bp/yr) plus a skew term, with the cap applied to the total; Window D charges interest only.
  - Longs pay when users are net long.
  - Payments truncate toward zero, and the house takes the exact opposite, so funding is zero-sum.
  - Underwater accounts are liquidated after settlement.
  - New windows parameter `fundingOiCapUsdc` (proposed values).
  - `MarketListed` v2, with v1 logs decoding as interest-free.
  - Golden vectors in `funding.json`.
- Limit orders:
  - A marketable limit fills at once as a taker; otherwise it rests GTC and fills, full fills only, when the house quote reaches it.
  - Resting orders are matched oldest first on every market-data update and pay the maker fee.
  - A resting order that fails its checks at trigger time is cancelled with the reason.
  - A circuit breaker does not cancel resting orders: those adding exposure wait until it clears, and reducing ones still fill.
  - Cancel by order id; at most 50 resting orders per account.
  - `PlaceOrder` v2 and a new `CancelOrder` input; open orders appear in the account snapshot.
  - API: `type`/`limitPrice` on `POST /api/orders`, and `DELETE /api/orders/:id`.
  - Terminal: a market/limit switch, a limit price field and an open-orders table with cancel.
- House risk limits (M4-14, ADR-0003 §7; parameters proposed in ADR-0019):
  - Past `inventoryCapUsdc` the house quotes one side only (`house-one-sided`).
  - Past `inventoryHardCapUsdc` the market is reduce-only, and no order may take the house beyond it (`house-inventory`).
  - A house loss above `houseDailyLossLimitUsdc` in a UTC day makes every market reduce-only until the next day (`house-loss-limit`). The limit arrives via the new `HouseRiskParams` input.
  - Resting orders wait out these limits. Market snapshots carry `inventoryLimit` and `houseLossLimit`, and the terminal explains the new rejections.
  - `MarketListed` v5.
- Flow shift (M4-03, ADR-0003 step 4; parameters proposed in ADR-0019):
  - Voluntary user fills feed an exponentially decayed net flow per market: a factor of `1 − 1/τ` per second, in fixed point.
  - Each wallet counts for at most `walletCap` per window. Liquidations do not count.
  - The quotes, never FV, index or mark, shift by `κ · netFlow`, clamped to ±h/2.
  - `windows.yaml` gets a `flow` block; `MarketListed` v4 (older logs: no shift).
- Fixed: a config change to only the funding interest, the partial-liquidation buffer or the flow parameters now re-lists the market at startup.
- House quote model (M4-02, ADR-0003; parameters proposed in ADR-0019):
  - The half-spread widens with σ_FV and skews with house inventory.
  - Fills pay a convex size impact `γ/(α+1)·(q/x_ref)^α`, in integer maths (α = 1.5 via an integer square root).
  - The ask rounds up and the bid down; degraded markets double the spread.
  - Market snapshots carry a €1k–€100k ladder from the same function that fills.
  - `MarketListed` v3. Older logs decode to the unchanged M1 quote.
  - Golden vectors in `quote.json`; `isqrt`/`isqrtCeil` in `@euroedge/fixed`.
- State snapshots (M4-19):
  - Lossless state codec: bigints stay bigints, Maps keep insertion order.
  - `engine_snapshots` table (migration 0004). The engine stores a snapshot every `ENGINE_SNAPSHOT_EVERY` events (default 10 000).
  - At startup the newest snapshot is used only if its digest matches its body and its chain hash matches the log. The whole hash chain is still verified from genesis.
  - Otherwise the engine replays from genesis.
  - Verifier CLI `pnpm --filter @euroedge/engine verify`: full replay from genesis with invariants, compared with every snapshot.
  - Property test: restoring at any seq and replaying the rest equals the live state byte for byte.
- CB7 capital floor (M4-15, ADR-0013):
  - The engine checks after every event; while CB7 is active, every market is reduce-only.
  - It trips when house equity (cash + uPnL at mark) or the insurance balance falls below 20 % of its genesis amount, and releases only when both are above 30 %.
  - Opening resting orders wait. Market snapshots carry `capitalFloor`.
- Stop and take-profit orders (M4-07):
  - `PlaceOrder` v3 takes `stop: { price, kind: 'stop' | 'take-profit' }` and an optional `ocoGroup`.
  - Triggers are evaluated on the mark. A buy stop or sell take-profit fires at mark ≥ price; a sell stop or buy take-profit fires at mark ≤ price.
  - A fired stop executes as a taker: market, or at its limit for a stop-limit. A stop-limit that does not cross keeps resting as a maker limit.
  - TP/SL: when one order of an account's OCO group fills, the others are cancelled (reason `oco`).
  - Placement rejects a stop that would fire at once (`would-trigger`), and a reduce-only stop with no position to reduce.
  - Opening stops wait out circuit breakers.
  - The account snapshot and the terminal's open-orders table show triggers; stop-market orders are listed as "Market".
  - The property test now also places limits, stops, take-profits, OCO pairs and cancels, spread over several funding hours.
- Partial-first liquidation:
  - The engine closes the fewest lots of the triggering position, at mark with the penalty to insurance, so that equity is back at MM × (1 + buffer).
  - Formula: `k = ⌈(T·MM·10⁴ − E·10⁸) / (mark·tv·(T·mm − pen·10⁴))⌉` with `T = 10⁴ + buffer`.
  - It falls back to full liquidation if that is impossible or would leave less than the minimum notional.
  - New `partialLiquidationBufferBps: 2500` in `windows.yaml` (proposed); v1 logs keep full liquidation.

### M3 — Full fv-core (in progress, on `integration/m3`)

#### Added

- Anchor manager (M3-01):
  - GBX and DKK closes are converted to EUR at `t_C`.
  - EURDKK falls back to the 7.46038 peg without a feed and raises an alert beyond 0.5 %.
  - NOVO and SHEL are enabled.
- Dividends per line (M3-02): the anchor moves on the local ex-date, and the ADR signal uses its own ex-date without double counting.
- ADR basis `b_A` as an EWMA of close-to-open residuals, with a configurable half-life (M3-03).
- Basket FV (M3-10/11):
  - The level is the weighted sum of constituent FVs relative to base prices.
  - Constituents without data are dropped and the weights renormalized; the snapshot lists them.
  - No basket FV is published below 50 % weight coverage.
  - σ comes from an EWMA covariance, with ρ = 1 until enough samples exist (never independence).
  - EE-Blue 20 and EE-Semis are enabled (10x in Window A).
- Pure circuit-breaker state machines on event time (M3-12):
  - CB1 ADR/Tradegate divergence;
  - CB2 primary halt;
  - CB3 stale index, plus the ADR-0008 Tradegate escalation (> 5 min → reduce-only, released after 2 min fresh);
  - CB4 EE-Blue −7 %, global for 15 min;
  - CB8 mark pinned to the band (ADR-0009).

  Parameters live in `fv.yaml`.

- Circuit breakers take effect end to end (M3-13):
  - fv-service evaluates them every second, with halts detected by `FeedMonitor`.
  - The effect is carried on `MarketData` (event v2; v1 logs decode as `none`).
  - The engine rejects new exposure under any breaker and doubles the house half-spread when degraded.
  - The terminal shows a breaker badge.
  - CB3 only applies while a live source is scheduled. Off-hours, FV_last widening is the design and does not count as stale.
- Backtest CLI and metrics (M3-14/15):
  - Replays through the production pipeline and scores against the next official open.
  - Reports MAE/RMSE, p99.9, improvement vs the last close, band coverage and a PIT histogram, per window.
  - Comparisons are dividend-aware.
  - Sample report in `docs/backtest/`.
- Reopen snap (M3-08/09):
  - The opening-auction print (never an indicative) re-centres FV, index and band.
  - The 50 bp/s step cap is suspended for 60 s.
  - An open outside the prior band sets the market reduce-only for 5 min (breaker `SNAP`).
  - Live-min VWAP reconciliation and the 3-min-VWAP liquidation price arrive with the vendor feed and M4.
- Public methodology v1 (`docs/methodology/README.md`), covering FV, index, mark, snap, baskets and breakers (M3-18).
- Golden vectors (M3-17): hand-derived fee, liquidation-price and FV examples in `docs/methodology/examples/`, checked in CI. Funding vectors follow in M4.
- σ-floor fit (M3-16): walk-forward per-window proposal (`--fit`). It is not applied; the Window A band semantics need a founder decision.

### M2 — Data layer (complete, on `integration/m2`)

#### Added

- Six more stock perps (founder request): Allianz, Airbus, Deutsche Telekom, Infineon, Schneider Electric and L'Oréal. They use the same window leverage as the other stocks (5x in Window A). `GET /api/markets` feeds the terminal's market list, so new tickers need only a `markets.yaml` entry.

- Curated venue calendars 2026–2028 in `config/calendars/` for XETR, TGAT, LSX, XAMS, XPAR, XCSE, XLON, XNYS, XNAS, USON, XEUR and FX. They cover holidays, half-days, auction phases and random-end ranges, with a schema and a generated browser-safe module (M2-01…04).
- Venue-state resolver (`venueState`, `nextVenueTransition`) and a holiday-aware window resolver (M2-05/06). Tests cover a cross-check against an `exchange_calendars` 4.13.2 fixture, holidays, half-days, the US overnight session and a 120-day coverage guard (M2-07).
- `markets.yaml` lists all ten markets (M2-17):
  - Five EUR stock perps are enabled.
  - NOVO and SHEL follow the ADR-0017 window and price-source rules. They stay disabled until EUR conversion of the anchor lands in M3.
  - RHM is a late launch.
  - EE-Blue 20 (20 constituents, 10 % cap) and EE-Semis (5 constituents, 35 % cap) are draft baskets that need founder sign-off.
- Underlying helpers in `@euroedge/shared`: `allUnderlyings`, `basketConstituents`, `underlyingLines`.
- An `OTCM` calendar for OTC ADRs (SIEGY, LVMUY).
- The terminal switches between the five enabled markets (`?market=`).
- Sim world v1 (M2-09…12):
  - market and sector factors, and every basket constituent;
  - EURUSD, EURGBP, and EURDKK pegged at 7.46038;
  - DKK/GBX primary lines;
  - local and ADR dividends on separate ex-dates;
  - opening/closing auctions with a random end;
  - US pre-market, after-hours and overnight quotes;
  - seeded and scheduled faults (bad print, stale feed, halt);
  - `config/sim.yaml`.
- Tick CSV format (`docs/data-format.md`), a committed two-week sample in `data/sample/`, and a `ReplayProvider` with a 1–1000× virtual clock (M2-13/14).
- A key-gated `PythProvider` (M2-15). It refuses to start without `PYTH_API_KEY` and is tested against a recorded-shape fixture; the wire format is unverified until the key arrives.
- Stub providers for Tradegate, Xetra delayed and Eurex, with licence/attribution metadata and the source list per tier (M2-16).
- `FeedMonitor`: halt detection from feed silence and provider health (M2-08).
- Ingest v1 (M2-18):
  - `DATA_TIER=replay` streams a tick file at `REPLAY_SPEED`;
  - `live-min` refuses to start until the Tradegate vendor and Pyth key exist;
  - exact duplicate ticks are dropped.

  Ticks keep their source currency; GBX/100 and FX conversion happen in fv-core (M3).

- `markets.yaml` lists all ten markets (M2-17):
  - Five EUR stock perps are enabled.
  - NOVO and SHEL follow ADR-0017 but stay disabled until EUR conversion of the anchor lands in M3.
  - RHM is a late launch.
  - EE-Blue 20 and EE-Semis are draft baskets that need founder sign-off.
- An `OTCM` calendar for OTC ADRs (SIEGY, LVMUY).

### M1 — Thin vertical slice (2026-10-27, on `integration/m1`)

#### Added

- Shared schemas and config (M1-01), interim calendar with A/B/C/D windows (M1-02), deterministic simulated world (M1-03), ingest to Timescale/Valkey (M1-04).
- fv-core v0 (M1-05) and fv-service (M1-06): Tradegate + ADR signals, band, Window A median-of-three index, step-capped and band-clamped mark.
- Engine: event model and hash chain (M1-07), Postgres event store (M1-08), sequencer + bootstrap + publisher (M1-09), ledger (M1-10), risk-core (M1-11), deterministic core with orders, liquidation and invariants (M1-12).
- Invariant property harness (M1-13) and a full simulated trading day replay test (M1-21).
- ExecutionAdapter + SimAdapter (M1-14), API v0 with dev login, orders and WebSocket (M1-15), bare trade terminal (M1-16/17).
- Playwright e2e + axe accessibility in CI (M1-18, M1-20), screenshots and demo script (M1-22), report `docs/milestones/m1.md` (M1-19).

#### Fixed

- House equity now includes the house cost basis when flat in lots (Invariant 7).
- Language switcher accessible name (WCAG 2.5.3); WebSocket account channel bound strictly to the session.
- German order copy; chart number locale; web lint runs `next typegen` first on fresh checkouts.

### M0 review decisions (2026-10-27)

#### Changed

- `PLAN.md` v2.1 and ADRs 0005/0008/0011/0013/0016 record the founder's M0 review:
  - Invariant 7 in full form, plus Invariants 8 (house equity ≥ 0) and 9 (insurance ≥ 0);
  - funding cap on the total rate;
  - Tradegate-stale escalation (> 5 min → reduce-only, released after 2 min fresh);
  - CB7 hysteresis (20 % trigger / 30 % release);
  - axe-core in CI from M1, and a per-milestone re-check of jsx-a11y ESLint 10 support;
  - shadcn reconciliation once the registry is reachable;
  - new M1 tasks M1-20…22.

### Research (2026-10-27)

#### Added

- `.claude/skills/`: three reviewed, pinned, MIT-licensed agent skills (`web-interface-guidelines`, `make-interfaces-feel-better`, `accessibility`) with provenance in `.claude/skills/README.md`.
- `CLAUDE.md`: precedence rules and skill overrides for coding agents.
- `docs/research/skills-review.md`: every candidate from skill-issue.in and why it was installed, parked or rejected.
- `docs/research/ui/design-notes.md`: interim UI principles and the WCAG 2.2 requirements they surfaced (2.1.4 single-key shortcuts must be switchable off; 2.4.11; 2.5.7; 2.5.8).

### M0 — Scaffold (2026-10-27)

#### Added

- `PLAN.md` v2 with the founder's decisions, and ADRs 0001–0017 (`docs/adr/`).
- **M0-01** pnpm 12 / Turborepo 2.11 monorepo, strict TypeScript 6.0, Node 24.22 pin; `docs/versions.md`.
- **M0-02** ESLint 10 (type-aware) + Prettier + commitlint + lefthook. Determinism lint rules for engine-core code.
- **M0-03** Vitest 5 workspace config; fast-check defaults (`FC_NUM_RUNS`, `FC_SEED`).
- **M0-04** `compose.yaml` (TimescaleDB 2.31/pg17, Valkey 8.1, Caddy 2.11 single origin on :8080). `packages/db`: Kysely client (int8 → bigint) and a checksummed plain-SQL migration runner.
- **M0-05** `packages/shared`: zod-4 env/YAML config loader, data-tier feature gates, `.env.example`. Runtime guard refusing `DEV_LOGIN` outside `DATA_TIER=sim` in local/ci.
- **M0-06** `packages/fixed`: branded bigint units, five explicit rounding modes, exact decimals.
- **M0-07** `packages/fixed`: market units with integer tick value (100 µUSDC stocks, 10 µUSDC baskets), exact PnL/notional, fees rounding up.
- **M0-08** `packages/service-kit` (pino, `/health`, `/ready`, graceful shutdown) and skeletons for engine, fv-service, ingest, api, relayer, indexer, bots and the backtest CLI.
- **M0-09** `apps/web`: Next.js 16.4 with PPR shell, next-intl en/de, dark/light themes, testnet banner. `packages/ui`: design tokens with colour-blind-safe up/down palettes, Button on Base UI. WCAG AA contrast tests.
- **M0-10** GitHub Actions CI (guards, checks with service containers, audit, contracts placeholder); `pnpm check:guards`.
- **M0-11** README, CONTRIBUTING (founder review gate), PR template, this changelog.

#### Fixed

- `apps/web` typecheck now runs `next typegen` first. Before this, it failed on a fresh clone; found by verifying M0 from a clean clone.

#### Notes

- **shadcn:** the CLI's default preset is `base-nova` (Base UI), which confirms ADR-0005. The registry host `ui.shadcn.com` is blocked by this environment's network policy, so the first components were written by hand following shadcn conventions. `components.json` is in place for `shadcn add` later.
- **Release-age policy:** typescript-eslint is pinned to 8.72.0 because 8.72.1 is younger than pnpm's 24 h `minimumReleaseAge`.
