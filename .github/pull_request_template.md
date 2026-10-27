## Task

<!-- PLAN.md task ID and one-line summary, e.g. "M1-07 — event envelope + hash chain" -->

## Changes

## How to test

## Checklist

- [ ] `pnpm lint typecheck test build` and `pnpm check:guards` are green
- [ ] Tests added or updated (property tests for financial maths)
- [ ] `README.md` / `CHANGELOG.md` updated
- [ ] **Changes FV, mark, funding, margin, ledger or contract maths** → labelled `needs-founder-review`; golden vectors and invariants updated
- [ ] No floats for money; no new deviation from the brief without an ADR
