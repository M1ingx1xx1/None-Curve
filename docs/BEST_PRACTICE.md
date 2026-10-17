# Best Practices

**English** · [中文](BEST_PRACTICE.zh.md)

Working conventions for None-Curve. Follow these when changing the app or its documentation.

## App language

- **The web app UI is English only.** No Chinese (or other CJK) text anywhere a user can see or hear it: visible text, button labels, placeholders, `title`, `aria-label`, `alt`, error messages, and the page `<title>`.
- Keep all source under `src/` in English, including code comments, so the rule can be checked mechanically.

Check before committing (should print nothing):

```bash
grep -rnP '[\x{3000}-\x{9fff}\x{ff00}-\x{ffef}]' src index.html
```

## Documentation language

- Every document has **separate English and Chinese editions**; never mix both languages in one file.
- English is the default: `NAME.md` is English, `NAME.zh.md` is Chinese.
- Each edition starts with a language switch linking to the other, for example `**English** · [中文](NAME.zh.md)`.
- When you change one edition, update the other in the same change so they stay in step.
- In Chinese documents, refer to interface elements by their English labels (the UI is English), with a Chinese explanation where helpful.

Current pairs: `README.md` / `README.zh.md`, `docs/USER_GUIDE.md` / `docs/USER_GUIDE.zh.md`, `docs/PRD.md` / `docs/PRD.zh.md`, `docs/PHASE.md` / `docs/PHASE.zh.md`, `docs/BEST_PRACTICE.md` / `docs/BEST_PRACTICE.zh.md`, `docs/EXPERIMENTAL_PLAN.md` / `docs/EXPERIMENTAL_PLAN.zh.md`, `docs/SOUND_PLAN.md` / `docs/SOUND_PLAN.zh.md`.

## Tests

- Tests live in `tests/`, by area (`tests/geometry`, `tests/export`, `tests/font`, `tests/sound`, `tests/state`, `tests/worker`); slow ones go in `tests/slow`.
- `npm test` runs the fast suite (about 15 s). `npm run test:slow` runs the slow one (the whole 42 s Sound test track, and every glyph of both fixture fonts; about 3 minutes); it runs only when asked for by name.
- `npm run build` type-checks the tests and scripts as well (`tsconfig.test.json`).
- Run `npm test` before opening a pull request into `develop`. CI runs `npm test` and `npm run build` on every pull request into `develop` and every push to it, and the Pages deploy runs `npm test` before it builds.
- Fixture fonts are open-licensed only (OFL: STIX Two Text and Roboto), each with its `OFL-*.txt` beside it in `tests/fixtures/fonts`. Never add a font that may not be redistributed.
- A test that finds a bug in `src/` stays in, as `it.skip` with a `BUG:` comment that says what is wrong, until the bug is fixed.
- Generated files are not committed. The Sound test track is rendered by `npm run test-track` (from `scripts/test-track.ts`) into `test-audio/sound-test.wav`, which git ignores; a test checks that it renders the same samples every time.

## Geometry and the workers

- Glyph geometry is computed only in the geometry worker (`src/geometry/geometry.worker.ts`, its logic in `workerCore.ts`), never on the page. The canvas, the text preview, live Sound frames, and SVG and PNG export all ask the page's client (`src/state/geometryClient.ts`): exports through `ensure()`, live frames through `prefetch()`. Do not add a main-thread fallback; when the worker cannot run, the canvas says so and asks for a reload.
- The protocol (`src/geometry/protocol.ts`): every compute request has an id and ends with exactly one answer, on every path (a font the worker does not have included): `done` (with `stopped` when a newer request or a `cancel` stopped it between glyphs) or `failed` (with a reason). The worker sends `glyph` before each glyph: the page's heartbeat, which also says which glyph to blame. A new message type keeps these rules.
- The client: a worker silent for 60 s on a glyph has that glyph marked failed ("Took longer than 60 s; try lighter settings") and is restarted, with the font sent again; more than 3 restarts within 60 s stop geometry until the next font, and the canvas says why. New settings replace a worker stuck for 750 ms or more on a glyph they no longer need (at most once every 2 s, and never for a live frame). Keep heavy settings fast inside the pipeline, as the Experimental vertex budget does (EXPERIMENTAL_PLAN §4.10), rather than raising these limits.
- Font export runs in a worker of its own for each build (`src/export/fontExport.worker.ts`). Cancel terminates it at once, and so does a minute without progress. Only when that worker cannot start does the build run on the page.
- Test the worker logic and the client without a browser: `tests/worker` runs `workerCore` with a fake `post`, and the client with a fake worker and fake timers.

## Slider ranges

- Every Geometry and Experimental slider's range and step is written once, in `src/state/sliderScales.ts`: `SLIDER_RANGES`, keyed by the slider's Sound target id (`"group.key"`, `"experimental.effect.key"`), and `TOLERANCE` for the logarithmic Tolerance slider.
- The panel spreads that entry into its range input (or names the target on `RangeField`), and Sound (`src/sound/mapping.ts`) and the saved-session check read the same entry, so a live or restored value is always one the slider can produce.
- Never write a slider's min, max, or step anywhere else; to change a range, change its entry. A new slider gets its entry there first. `sliderRange(id)` throws for an id that has none, so a typo fails at once.

## Saved settings and undo

- The session (the settings, the canvas view buttons, the text, the preview's look, the export precision, the Sound mappings, and which font and glyph were open) is saved in `localStorage` under one versioned key, `none-curve:session` (`src/state/persist.ts`), a moment after each change. `none-curve:restoring` is set while restored settings are first drawn, so a visit that crashed doing that starts the next one at the default settings. Small per-browser conveniences (the chosen tab, panel splits, Show all explanations) keep their own `none-curve:` keys.
- Not saved: Drive letters, the audio source, live values, dialogs, the theme, and zoom and pan.
- A saved session is read once, on start, leaf by leaf against the defaults: a wrong type or an unknown choice falls back to the default, a number out of range is clamped into it, and unknown keys are dropped, so a damaged or older entry never breaks the app. A new setting needs a default in `initialState`, and its range or choices in `persist.ts` (`RANGES`, `CHOICES`, `ENUMS`), unless it is a slider in `SLIDER_RANGES`, whose entry is used.
- Renaming or moving a saved setting, or renaming a Sound feature or target id, needs a migration: raise `SESSION_VERSION` and add a step to `MIGRATIONS` that turns the old names into the new ones, so earlier sessions keep their values (the step from sessions without a version renames Phase 9's effects and the merged Sound features). Never reuse an old name for something else. A newer session read by an older app is read as far as it fits.
- Wrap every `localStorage` access in `try`/`catch`: storage may be blocked or full, and the app then works without saving.
- Undo (`src/state/history.ts`): changes are recorded where they are made (App's `edit` and text setters, the mapping store), never in the reducer, which stays pure. Settings change through `edit`; the canvas view, glyph selection, export settings, and imports use `dispatch` and are not undone. Record each change with a key naming what it changes (`edit` works it out from the settings that changed), so one slider drag is one step, and wrap a change made of several updates (a preset Load, Freeze, a target with what it switches on) in `undoHistory.transaction`. Live Sound frames never dispatch, so they never enter the history.
