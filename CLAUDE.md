# EuroEdge — instructions for coding agents

EU-equity perpetuals **testnet** (play money). Read `PLAN.md` (§0 decision log first) and `docs/adr/` before changing behaviour. `CONTRIBUTING.md` has the workflow.

## Precedence

Founder decisions (`PLAN.md` §0) > ADRs > the original brief > `CONTRIBUTING.md` > vendored skills in `.claude/skills/`. If anything conflicts, follow the higher source and say so. Never deviate silently: write an ADR and ask.

## Hard rules

- **Review gate.** Changes to FV, mark, index, funding, margin, liquidation, fees, ledger or contract maths need explicit founder review before merge: PR label `needs-founder-review`.
- **No floats for money.** Use `@euroedge/fixed`. Engine-core code never reads the clock or uses `Math`/timers/randomness (ESLint enforces this).
- **Determinism.** The engine consumes logged inputs only, and replay must equal live bit for bit.
- **Data.** `DATA_TIER=sim` by default. Never call paid APIs without keys. `DEV_LOGIN=true` only with `DATA_TIER=sim` in local/ci.
- **Copy.** No trademarked index names (DAX, STOXX, Euro Stoxx, CAC, FTSE) in user-facing text. Waitlist copy says "register interest".
- **Process.** One task per branch, ≤ ~400 LOC, conventional commits, tests with the code, README/CHANGELOG kept current.

## Commands

`pnpm infra:up` · `pnpm db:migrate` · `pnpm dev` (open http://localhost:8080) · `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build` · `pnpm check:guards`

## Skill overrides

The skills in `.claude/skills/` are general-purpose. In this repo:

- **Visual direction is ADR-0007** (calm, precise, institutional). Ignore any push toward "bold/brutalist/aesthetic risk" in the terminal. The landing page (M8) may carry one distinctive element.
- **Motion in the trading terminal:**
  - No scale-on-press on order entry, Buy/Sell, ladder or table rows.
  - No staggered or blur entrances.
  - Price flashes are a background tint of ≤ 150 ms.
  - Everything respects `prefers-reduced-motion`.
  - `make-interfaces-feel-better` motion patterns apply only to the landing page and onboarding.
- **Monospace and dark** are deliberate here (brief §11.1): prices, the quote ladder and numbers use mono + tabular figures, and dark is the default theme. Do not "fix" these as AI-default tells. Do avoid decorative tracked ALL-CAPS eyebrow labels.
- **Case:** UI copy uses sentence case (Linear-style; German UI), not the Title Case that `web-interface-guidelines` suggests.
- **Tooling:** never install tools globally (`npm -g`, `npx lighthouse` against prod). Use the repo's pinned tools: `@axe-core/playwright` in Playwright tests, Lighthouse CI in M7.
- **Accessibility target:** WCAG 2.2 AA, plus EN 301 549 / European Accessibility Act context, not US ADA/VPAT framing.
