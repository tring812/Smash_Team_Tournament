# Contributing

How we branch, commit and open pull requests. Code rules are in [AGENTS.md](AGENTS.md).

## Branches

| Branch | Purpose |
|---|---|
| `main` | Released code. Changes arrive **only through pull requests**. Never push or force-push to it. |
| `develop` | Integration branch. Small, finished commits may go straight here; anything larger uses a feature branch. |
| `feat/<short-name>`, `fix/<short-name>`, `docs/…`, `chore/…` | Work branches, cut from `develop`, merged back by PR. |

- Branch names: lowercase, hyphens, no Vietnamese diacritics — `feat/referee-accounts`, `fix/excel-division-rows`.
- Keep work branches short-lived; rebase on `develop` before opening the PR if it has moved.
- Release: open a PR `develop → main` titled `Release: <summary>`; merge with a merge commit.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), in **English**:

```text
<type>(<scope>): <summary>

<body: what changed and why, as "- " bullets, wrapped at ~90 columns>

<trailers>
```

**Types**

| Type | Use for |
|---|---|
| `feat` | a new user-visible feature or API |
| `fix` | a bug fix |
| `docs` | README, FEATURES.md, CHANGELOG-only or comment-only changes |
| `test` | adding or fixing tests only |
| `refactor` | code change with no behaviour change |
| `perf` | performance improvement |
| `ci` | `.github/` workflows, Dependabot |
| `build` | dependencies, package manifests, Docker |
| `chore` | anything else (tooling, cleanup, repo housekeeping) |

**Scope** (optional): `web` (frontend only), `api` (backend only), `db` (migrations), `ci`.
Leave it out when a change spans backend and frontend.

**Summary line**

- Imperative mood, lowercase after the colon, no trailing period, ≤ 72 characters where possible.
- Say what a user or developer gets: `feat: organizers manage referee accounts from the tournament admin page`.
- Vietnamese UI terms may appear as-is when they are the clearest name: `referee-only Trọng tài`.

**Body**

- Required for anything beyond a one-line change. Explain the *why*, list notable behaviour, new
  endpoints (`GET /tournaments/:id/referees`), migrations (`migration 008`), and limits.
- Breaking API or schema change: add `!` after the type (`feat!:`) and a `BREAKING CHANGE:` paragraph.
- Reference issues with `Closes #12` / `Refs #12`.

**Trailers**

- AI-assisted commits end with a `Co-Authored-By:` line naming the assistant, e.g.
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**One commit, one change.** It should build and pass tests on its own; don't mix a refactor with a feature.
Never commit secrets, `.env`, `.pgdata/` or real registration data.

## Pull requests

1. Branch from `develop`, commit, push, open a PR into `develop` (or `develop → main` for a release).
2. **Title** follows the commit format: `feat: …`, `fix(web): …`. For a release PR: `Release: <summary>`.
3. **Description** uses the template ([.github/pull_request_template.md](.github/pull_request_template.md)):
   summary, why, how it was tested, screenshots for UI changes, migration / API notes.
4. CI must be green (backend tests + audit, frontend typecheck + lint + build + audit).
5. Keep PRs focused and reviewable — split unrelated changes. Update `CHANGELOG.md` (`[Unreleased]`) and
   `docs/FEATURES.md` in the same PR when behaviour changes.
6. Address review comments with new commits; squash or merge as the reviewer prefers. Delete the branch after merge.
7. AI-generated PR descriptions end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
   (or the equivalent for the tool used).

### Review checklist

- [ ] Permissions: can an organizer of another tournament, a referee or an anonymous visitor reach this?
- [ ] Input validated with zod; SQL parameterised; writes in `withTx`.
- [ ] No MSSV / SĐT / email in public responses or in `tournament_events`.
- [ ] New migration is numbered, idempotent, wrapped in a transaction; old migrations untouched.
- [ ] Tests cover the new behaviour and the permission edges.
- [ ] UI works on a phone (light theme only); text is in Vietnamese.
- [ ] CHANGELOG / FEATURES.md / README updated where needed.
