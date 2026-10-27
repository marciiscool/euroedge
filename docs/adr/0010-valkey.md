# ADR-0010 — Valkey instead of Redis

- **Status:** Accepted (founder, 2026-10-27); client choice amended at M0.

## Context

The brief allows Redis 8 or Valkey 8. Redis 8 ships under RSALv2/SSPLv1/AGPLv3; Valkey is BSD-3.

## Decision

- **Valkey 8** (`valkey/valkey:8` image, pinned by minor version in compose).
- **Client:** `ioredis` 6, not `iovalkey`. `ioredis` is more mature and fully wire-compatible with Valkey 8; `iovalkey` is still 0.x. Switching later is a one-module change in `packages/service-kit`.

## Consequences

- Valkey is used for pub/sub, Streams (the engine input queue), rate limits, SIWE nonces and hot state.
