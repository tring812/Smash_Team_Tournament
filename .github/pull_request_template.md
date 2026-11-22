## Summary

<!-- What changes, in 1–3 bullets. Title format: `feat: …`, `fix(web): …` (see CONTRIBUTING.md). -->

-

## Why

<!-- The problem or request behind it. Link issues: Closes #… -->

## How it was tested

- [ ] `cd backend && npm test`
- [ ] `cd frontend && npm run typecheck && npm run lint`
- [ ] Tried in the browser (desktop + phone width, light + dark) — describe what you checked:

## Screenshots

<!-- Required for UI changes. Delete this section otherwise. -->

## Notes for reviewers

- [ ] New migration: <!-- e.g. 009_xxx.sql — idempotent, in BEGIN/COMMIT -->
- [ ] API change: <!-- endpoint, request/response shape, new error codes; types.ts updated -->
- [ ] Permissions reviewed (admin / organizer of this tournament / other organizer / referee / anonymous)
- [ ] No personal data (MSSV, SĐT, email) exposed publicly or written to the event log
- [ ] CHANGELOG.md `[Unreleased]` and docs/FEATURES.md updated
