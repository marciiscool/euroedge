# ADR-0012 — Caddy as single-origin reverse proxy

- **Status:** Accepted (founder, 2026-10-27)

## Context

SIWE session cookies must be same-site. WebSocket upgrades through Next.js rewrites are unreliable.

## Decision

Caddy 2 fronts everything, in dev (docker-compose) and in prod, on **one origin**:

| Path            | Target                  |
| --------------- | ----------------------- |
| `/api/*`        | api (REST)              |
| `/ws`           | api (WebSocket upgrade) |
| everything else | web (Next.js)           |

- The `Origin` check on WebSocket upgrades compares against that single configured origin.
- No CORS anywhere.
- Prod adds automatic TLS, security headers (CSP from the web app) and compression.

## Consequences

- In dev, browse to `http://localhost:8080` (Caddy), not to Next's port directly.
