# None-Curve

Vite + React 19 + TypeScript web app that rebuilds font outlines from curves into straight segments; deployed to GitHub Pages. Talk to the user in Chinese; everything written to the repo follows the rules below.

## Task card (every instruction)

Start each reply to a new instruction with this card, values in Chinese, labels as-is. Then act on it right away; stop and wait only when `Ask` holds a blocking decision.

```
Goal:   <one sentence: the outcome the user wants>
Type:   feature | fix | refactor | docs | config | question
Scope:  <files/modules to touch, or read-only>
Rules:  <project rules that apply, or none>
Skills: <skills to invoke, or none>
Plan:   <1-3 steps>
Done:   <how completion is checked: build / preview / CJK grep ...>
Ask:    <decisions only the user can make, or none>
```

Short follow-ups ("yes", "continue", one-line questions) get a one-line card: `Goal: ... | Skills: ...`. Never repeat the card in the closing summary.

## Skills: invoke automatically

Match every request against the available-skills list and call the Skill tool before other work when one fits; don't ask first. Common matches:

| Request | Skill |
|---|---|
| run, preview or screenshot the app; verify a UI change | `run` |
| review a diff, branch or PR | `code-review` |
| tidy code just changed | `simplify` |
| security pass before merging | `security-review` |
| settings.json, hooks, permissions, env vars | `update-config` |
| charts, plots, data visualizations | `dataviz` |
| turn a repeated workflow into a skill | `skill-creator` |
| look for a third-party skill | `find-skills`: vet installs, stars and audits, show SKILL.md, install only after approval |

## Token budget

- Never Read these whole; `grep -n` for the heading or symbol, then Read with `offset`/`limit`: `README*.md` (~100 KB), `docs/USER_GUIDE*.md` (~75 KB), other `docs/*.md` (30-40 KB), `src/components/SoundControls.tsx`, `src/components/ExperimentalControls.tsx`, `src/sound/{engine,features,live,mapping}.ts`.
- Skip `node_modules/`, `dist/`, `package-lock.json`, `test-audio/`, `resources/` unless the task is about them.
- Research from the English doc; open the `.zh.md` edition only to edit the matching section.
- Batch independent reads and greps into one Bash call or parallel tool calls. Send broad multi-directory searches to an `Explore` subagent.
- Don't re-read a file after editing it. Don't echo file contents or diffs back to the user.
- Trim output: `npm run build 2>&1 | tail -30`.
- Browser checks: use `read_page` / `get_page_text`; one screenshot only as final proof of a visual change.
- Keep replies short; don't restate what the card already says.

## Compact instructions

When compacting, keep: the current task card, files changed and why, decisions the user made, open questions, current branch. Drop: file contents, command output, superseded plans.

## Project map

- `src/font/` load and parse fonts (local files, Google Fonts, WOFF2)
- `src/geometry/` curve-to-line pipeline, run in `geometry.worker.ts`; entry `pipeline.ts`
- `src/specimen/` artboard, scene, palette
- `src/sound/` audio analysis and parameter mapping
- `src/export/` SVG, OTF, PNG export
- `src/state/` editor state and hooks; `src/components/` UI
- `docs/` PRD, PHASE, plans, USER_GUIDE (for non-programmers), BEST_PRACTICE (conventions)

## Commands

- Type-check and build: `npm run build` (also type-checks `tests/` and `scripts/`)
- Lint: `npm run lint` (ESLint over the whole project; CI runs it before the tests)
- Tests: `npm test` (fast suite, well under a minute; CI runs it with lint and the build on PRs into `develop`); `npm run test:slow` (the test track and every glyph of both fixture fonts, about 3 minutes)
- Test track: `npm run test-track` writes `test-audio/sound-test.wav` (rendered, not committed)
- Dev server: preview_start `dev` (port 5173), never through Bash
- Run `npx` from the project dir; `cd ~` first triggers a gvm error

## Rules

- UI and all of `src/` are English only. After touching `src/` or `index.html`, this must print nothing: `grep -rnP '[\x{3000}-\x{9fff}\x{ff00}-\x{ffef}]' src index.html`
- Docs come in pairs, `NAME.md` (English, default) and `NAME.zh.md` (Chinese); update both in the same change and never mix languages in one file. Details in `docs/BEST_PRACTICE.md`.
- No visible captions beside self-explanatory icons; keep their aria names.
- Git: branch `feature/NOCUR-<n>-<name>` off `develop`, open PRs into `develop`. `main` is the release branch; pushing it deploys Pages.
- Jira: with the issue key in the branch name or PR title, `.github/workflows/jira.yml` moves the issue (PR open → In Progress, merged → Done); by hand, only its description and the release record (NOCUR-28) are updated. Rules in `docs/BEST_PRACTICE.md` ("Branches, pull requests, and Jira").
