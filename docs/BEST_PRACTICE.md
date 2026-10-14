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

- Tests live in `tests/`, by area (`tests/geometry`, `tests/export`, `tests/font`, `tests/sound`, `tests/specimen`, `tests/state`, `tests/worker`); slow ones go in `tests/slow`.
- `npm test` runs the fast suite (about 15 s). `npm run test:slow` runs the slow one (the whole 42 s Sound test track, and every glyph of both fixture fonts; about 3 minutes); it runs only when asked for by name.
- `npm run build` type-checks the tests and scripts as well (`tsconfig.test.json`).
- Run `npm test` before opening a pull request into `develop`. CI runs `npm test` and `npm run build` on every pull request into `develop` and every push to it, and the Pages deploy runs `npm test` before it builds.
- Fixture fonts are open-licensed only (OFL: STIX Two Text and Roboto), each with its `OFL-*.txt` beside it in `tests/fixtures/fonts`. Never add a font that may not be redistributed.
- A test that finds a bug in `src/` stays in, as `it.skip` with a `BUG:` comment that says what is wrong, until the bug is fixed.
- Generated files are not committed. The Sound test track is rendered by `npm run test-track` (from `scripts/test-track.ts`) into `test-audio/sound-test.wav`, which git ignores; a test checks that it renders the same samples every time.
- Code that needs browser APIs the tests cannot run (MediaRecorder, canvas capture, Web Audio, tab visibility) is split into pure modules and a controller that receives those APIs as injected dependencies, with a thin page singleton on top. The video recorder is the model: `RecordingController` (`src/export/recorder.ts`) takes its clock and timers, the sound engine, the canvas, MediaRecorder, the tab's visibility, and `save` as `RecorderDeps`, and `tests/export/recorder.test.ts` drives every take through fakes of them, so nothing touches the DOM. Canvas drawing takes a painter (`src/export/drawArtboard.ts`), so a recording fake checks it against the SVG export.
- Never make a real download. Tests pass a fake `save` (or another injected sink) and never call `downloadFile`. A browser check that exports or records first stubs `HTMLAnchorElement.prototype.click` to collect the link instead of following it, and keeps `URL.revokeObjectURL` a no-op so the collected blob can still be read.
- `tests/sound/neutral.test.ts` pins Sound with the Response settings at their neutral values (Strength 100%, Motion contrast, Pitch reactive, and Melody tracking 0) to its outputs at commit 4a54e5d, before those settings existed: exact, except the analyser's readings, which it hashes to 10 significant digits (see the next point). Never edit it, its hashes included: when it fails, a change has reached the neutral path, so fix the change.
- Hash numbers that come from `Math` functions (`log`, `exp`, `sin`, and the like) rounded, not exact. V8's x64 and arm64 builds can differ in their last bit (`Math.log2` and `Math.log10` do), and CI runs on Linux x64 while a Mac with Apple silicon is arm64, so an exact hash pinned on one fails on the other. `neutral.test.ts` rounds such numbers to 10 significant digits, which both agree on and which still catches a change of one part in ten million. Pin a hash only after checking it on both, for example with the official x64 build of Node under Rosetta.
- Count flashes the way the screen shows them. `lettersOnScreen` in `tests/sound/flash.test.ts` counts a move between levels from any frame shown within the last 250 ms (`SPREAD_MS`, the same span as `LIVE_LIMITS.switchSpanMs`), and a frame's changes once, so a change that reaches the screen over several frames counts once and one spread thinly over frames is not missed.
- Check Sound in the browser with the tab visible. The sound is read on `requestAnimationFrame`, so a hidden or covered tab (a hidden browser pane included) gets no frames or only bursts of them, and the letters stop following the sound; "Live · N fps" shows the geometry rate, not how often the sound is read, so it does not reveal this.

## Geometry and the workers

- Glyph geometry is computed only in the geometry worker (`src/geometry/geometry.worker.ts`, its logic in `workerCore.ts`), never on the page. The canvas, the text preview, live Sound frames, and SVG and PNG export all ask the page's client (`src/state/geometryClient.ts`): exports through `ensure()`, live frames through `prefetchJobs()`. Do not add a main-thread fallback; when the worker cannot run, the canvas says so and asks for a reload.
- The protocol (`src/geometry/protocol.ts`): every compute request has an id and ends with exactly one answer, on every path (a font the worker does not have included): `done` (with `stopped` when a newer request or a `cancel` stopped it between glyphs) or `failed` (with a reason). A request carries one or more jobs (a parameter key and its glyphs), run in order; each `results` message holds one job's key. The worker sends `glyph` before each glyph: the page's heartbeat, which also names the key and the glyph to blame. A new message type keeps these rules.
- One live frame is one request. Its letters can react by different amounts, so it may need up to three parameter sets (the shared values, and a quiet and a strong level): `prefetchJobs()` sends them all as the jobs of a single request, the shared values first for every glyph shown, and the frame is committed only when all of them have arrived. Never send a frame's parameter sets as separate requests: a newer request supersedes the one in flight. Live results are kept apart from editing results, least recently used first out, at most `LIVE_KEPT_KEYS` (6) parameter sets, so the levels of the frame on screen stay while the next one computes.
- The client: a worker silent for 60 s on a glyph has that glyph marked failed ("Took longer than 60 s; try lighter settings") and is restarted, with the font sent again; more than 3 restarts within 60 s stop geometry until the next font, and the canvas says why. New settings replace a worker stuck for 750 ms or more on a glyph they no longer need (at most once every 2 s, and never for a live frame). Keep heavy settings fast inside the pipeline, as the Experimental vertex budget does (EXPERIMENTAL_PLAN §4.10), rather than raising these limits.
- Font export runs in a worker of its own for each build (`src/export/fontExport.worker.ts`). Cancel terminates it at once, and so does a minute without progress. Only when that worker cannot start does the build run on the page.
- Test the worker logic and the client without a browser: `tests/worker` runs `workerCore` with a fake `post`, and the client with a fake worker and fake timers.

## Slider ranges

- Every Geometry and Experimental slider's range and step is written once, in `src/state/sliderScales.ts`: `SLIDER_RANGES`, keyed by the slider's Sound target id (`"group.key"`, `"experimental.effect.key"`), and `TOLERANCE` for the logarithmic Tolerance slider.
- The panel spreads that entry into its range input (or names the target on `RangeField`), and Sound (`src/sound/mapping.ts`) and the saved-session check read the same entry, so a live or restored value is always one the slider can produce.
- Never write a slider's min, max, or step anywhere else; to change a range, change its entry. A new slider gets its entry there first. `sliderRange(id)` throws for an id that has none, so a typo fails at once.
- The Sound tab's own sliders follow the same rule from `src/sound/types.ts`: Sensitivity and Release from `SOUND_LIMITS` (`minSensitivity`, `maxSensitivity`, `sensitivityStep`; `minReleaseMs`, `maxReleaseMs`, `releaseStepMs`), and Strength, Motion contrast, Pitch reactive, and Melody tracking from `RESPONSE_LIMITS`. The store keeps the response values as fractions (Strength 1 is 100%) and the panel shows them in percent of the same entry; `clampResponse` and the saved-session check (`SOUND_RANGES` in `persist.ts`) read those entries too.
- Video limits are written once, in `VIDEO_LIMITS` (`src/export/videoFormat.ts`): the largest side and area, the 10-minute cap, the bitrate range, the audio delay range, and the recorder's timings. The Record options and the recorder read them from there.

## Saved settings and undo

- The session (the settings, the canvas view buttons, the text, the preview's look, the export precision, the Sound mappings, the Sound tab's Response group (Sensitivity, Strength, Motion contrast, Release, Pitch reactive, Melody tracking), and which font and glyph were open) is saved in `localStorage` under one versioned key, `none-curve:session` (`src/state/persist.ts`), a moment after each change. `none-curve:restoring` is set while restored settings are first drawn, so a visit that crashed doing that starts the next one at the default settings. Small per-browser conveniences (the chosen tab, panel splits, Show all explanations) keep their own `none-curve:` keys.
- Not saved: Drive letters, the audio source, the recording options (Format, Length, Include audio, Use the preview look), live values, dialogs, the theme, and zoom and pan. Sensitivity, Release, and the four response values are saved.
- A saved session is read once, on start, leaf by leaf against the defaults: a wrong type or an unknown choice falls back to the default, a number out of range is clamped into it, and unknown keys are dropped, so a damaged or older entry never breaks the app. A new setting needs a default in `initialState`, and its range or choices in `persist.ts` (`RANGES`, `CHOICES`, `ENUMS`), unless it is a slider in `SLIDER_RANGES`, whose entry is used. The Sound settings are one optional `sound` block read by `readSound`, against `SOUND_LIMITS` and `RESPONSE_LIMITS`.
- Adding a setting, or a block that earlier sessions lack, needs no migration: a missing value reads as its default. The `sound` block was added this way, and sessions stayed at version 2.
- Renaming or moving a saved setting, or renaming a Sound feature or target id, needs a migration: raise `SESSION_VERSION` and add a step to `MIGRATIONS` that turns the old names into the new ones, so earlier sessions keep their values (the step from sessions without a version renames Phase 9's effects and the merged Sound features). Never reuse an old name for something else. A newer session read by an older app is read as far as it fits.
- Wrap every `localStorage` access in `try`/`catch`: storage may be blocked or full, and the app then works without saving.
- Undo (`src/state/history.ts`): changes are recorded where they are made (App's `edit` and text setters, the mapping store, and the Response group, which records Sensitivity and Release before it sets them on the engine), never in the reducer, which stays pure. Settings change through `edit`; the canvas view, glyph selection, export settings, and imports use `dispatch` and are not undone. Record each change with a key naming what it changes (`edit` works it out from the settings that changed), so one slider drag is one step, and wrap a change made of several updates (a preset Load, Freeze, a target with what it switches on, Reset sound) in `undoHistory.transaction`. Live Sound frames never dispatch, so they never enter the history, and neither do the recording options or a recording.
