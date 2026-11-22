# AGENTS.md

Rules for AI coding agents (Claude Code, Codex, Cursor…) and humans working in this repo.
Git workflow, commit and PR rules live in [CONTRIBUTING.md](CONTRIBUTING.md) — follow them too.

## What this is

SmashTeam Tournament: a standalone web app for running amateur badminton tournaments — registration
import, draws, scheduling, court control, referee scoring on phones, standings, brackets, TV screen.
Users are Vietnamese: **all user-facing text, code comments, docs and CHANGELOG are in Vietnamese**.
Commit messages, PR titles/bodies and identifiers are in English.

Glossary: BTC = ban tổ chức (organizer), VĐV = vận động viên (athlete), nội dung = category (MS, WD, XD…),
bảng = group, trọng tài = referee, sân = court, MSSV = student ID, SĐT = phone number.

## Layout

| Path | What |
|---|---|
| `backend/src/app.js` | Express 5 routes (no `listen`; `server.js` starts it) |
| `backend/src/schemas.js` | zod schemas for every request body |
| `backend/src/domain/` | pure logic (scoring, draw, bracket, schedule, standings) — no I/O, no DB |
| `backend/src/services/` | business rules + SQL, one file per area |
| `backend/migrations/` | `NNN_name.sql`, applied in order by `npm run migrate` |
| `backend/test/` | `node:test`; `*.pglite.test.js` run on in-memory PGlite |
| `frontend/app/` | Next.js 16 App Router, React 19, Tailwind 4 |
| `frontend/app/lib/` | API client, types, Excel, search helpers |
| `frontend/app/components/` | shared UI (`ui.tsx` has Button, Card, Modal, Field…) |
| `docs/FEATURES.md` | full spec: features, permissions, business rules, API |

## Commands

Node ≥ 20.19 (CI uses 22). Run from the package folder.

```bash
cd backend && npm ci && npm test          # all backend tests, PGlite, no Postgres needed
cd frontend && npm ci && npm run typecheck && npm run lint && npm run build
```

Dev: see README § Chạy trên máy (`DATABASE_URL=pglite:.pgdata`, `DEV_LOGIN=1`, frontend on :3100).
Optional real-Postgres tests: `TEST_PG_HOST=localhost TEST_PG_PORT=5433 TEST_PG_DB=tournament_test npm test`
(`TEST_PG_DB` must contain `test` — it is wiped).

**Before you say a change is done**, run the checks CI runs for the side you touched: backend `npm test`;
frontend `npm run typecheck && npm run lint` (and `npm run build` for routing/config changes). Report
failures as they are; never skip or weaken a test to make it pass.

## Backend rules

- CommonJS, `'use strict'`, 2-space indent, single quotes. Types via JSDoc (`@param`, `@typedef`) — keep them.
- Every request body is validated with a zod schema in `schemas.js`. Never trust client input.
- SQL is always parameterised (`$1, $2`). Never build SQL from user strings.
- Multi-step writes go through `withTx(pool, async (c) => …)`; check permission **inside** the transaction
  (`requireOrganizer`, `roleIn`…) with the transaction client.
- Errors: throw `HttpError(status, CODE, 'Vietnamese message')` from `src/errors.js`. Codes are
  `UPPER_SNAKE` and are part of the API — the frontend matches on them.
- Organizer actions are recorded with `logEvent(...)` into `tournament_events` (append-only). Never log
  passwords, MSSV, phone or email values — log which fields changed instead.
- Keep `domain/` pure: if it needs the DB, it belongs in `services/`.
- Permissions: admin > organizer of that tournament > referee. An organizer must never be able to touch
  data or accounts belonging to another organizer's tournament. Add a test for every new permission rule.

## Migrations

- New file = next number: `009_short_name.sql`. **Never edit a migration that is already on `main`** —
  add a new one.
- Wrap in `BEGIN; … COMMIT;` and make it idempotent (`IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` then add).
- Adding a `tournament_events.action` value means re-creating `tournament_events_action_check` with the
  full list (see `008_referee_accounts.sql`).
- Must run on both Postgres 16 and PGlite (tests apply every migration in order).

## Frontend rules

- Next.js 16 has breaking changes from older versions. Check `frontend/node_modules/next/dist/docs/`
  before using an API you are not sure about.
- Client components start with `"use client";`. Double quotes, semicolons, 2-space indent (TypeScript strict).
- Call the backend only through `api()` in `app/lib/api.ts` (same origin, cookie session, CSRF header).
  Never store tokens in `localStorage`.
- Shared response types live in `app/lib/types.ts` — update them together with the backend change.
- Reuse components from `app/components/ui.tsx` and icons from `lucide-react` before writing new ones.
- Excel / CSV are parsed in the browser (`app/lib/excel.ts`); the server has no file upload endpoint — keep it that way.
- Must work on a phone (referees and spectators are mobile-first) and in both light and dark themes.

## Tests

- New behaviour needs a test: domain logic → `domain.test.js` style unit tests; service / permission /
  SQL → a `*.pglite.test.js` that applies all migrations (copy the `before()` setup of an existing file).
- Use the skip guard `{ skip: hasPglite ? false : '…' }` like the existing PGlite tests.
- Tests must not depend on order across files or on the clock beyond `Date.now()` offsets.

## Docs to update in the same change

- `CHANGELOG.md` → `## [Unreleased]` under `Added` / `Changed` / `Fixed` (Keep a Changelog, Vietnamese,
  user-facing wording; mention new endpoints and migrations).
- `docs/FEATURES.md` when a feature, permission, business rule or API changes.
- `README.md` when setup, config, commands or the folder layout change.

## Security and secrets

- Never commit `.env`, `.env.*` (except `.env.example`), `.pgdata/`, dumps, or real registration files
  (they contain students' MSSV / phone numbers). Use made-up data in tests and fixtures.
- Personal data (MSSV, SĐT, email) is returned only to organizers; public endpoints expose athlete ids, never those fields.
- GitHub Actions stay pinned by commit SHA with a version comment.
- Do not add a dependency without a clear need; pin exact versions (no `^`), keep `npm audit --audit-level=low` clean.

## Don'ts

- Don't push to `main`, force-push shared branches, or rewrite published history.
- Don't reformat files you aren't changing; keep diffs focused on the task.
- Don't change public API shapes or error codes silently — update `types.ts`, FEATURES.md and CHANGELOG.
