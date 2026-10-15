# Vector Poly-Font Editor

**English** · [中文](PHASE.zh.md)

## Project Implementation Plan & Technical Architecture

## Product summary

The Vector Poly-Font Editor is a client-side web app for turning font outlines into editable polygons. Designers load a `.ttf` or `.otf`, inspect and adjust the resulting contours, then export polygon-only SVGs or a generated font file.

The central workflow is:

```text
Load font → Parse glyph outlines → Flatten curves → Adjust geometry
          → Inspect in viewport → Export SVG or font
```

The font editor is the primary product and receives roughly 70% of product and design focus. Sound is a secondary extension, receiving roughly 30%; it drives the font editor’s existing geometry parameters and never gates the core font workflow. This is a planning allocation, not a literal screen-area requirement. The default landing workspace remains the font editor.

A key product distinction: “polygon-only” means the exported glyph outlines use straight-line segments. SVG can represent that directly with `M` and `L` commands. Font-file generation is a separate engineering challenge: it must convert the edited polygons into valid font glyphs and preserve required font metadata and metrics.

---

# Phase A: Architecture & Technical Stack

## 1. Proposed stack

> **As built (implementation status):** Vite instead of Webpack; fontkit for font parsing (TTF / OTF / WOFF / WOFF2); a hand-written pure TypeScript geometry core (`src/geometry/`, no Paper.js) rendered with SVG; a custom SVG serializer (`src/export/svg.ts`); OTF generation written with opentype.js and verified by reading back with fontkit (`src/export/fontFile.ts`). The table below is kept as the original proposal.

| Area | Recommended technology | Responsibility |
|---|---|---|
| UI | React | Controls, file handling, application shell |
| Build and deployment | Webpack | Development server, bundling, GitHub Pages build |
| Geometry rendering | Paper.js | Path construction, flattening, canvas rendering |
| Font parsing | opentype.js | Read font metadata, metrics, and glyph outlines |
| State | UI framework + dedicated geometry store | Keep controls responsive while geometry recomputes |
| SVG export | Custom serializer or Paper.js export | Emit explicit `M`/`L` contours |
| OTF generation | Font-generation library or custom pipeline | Assemble glyph outlines, metrics, and tables |

Use React for the UI; avoid building framework-specific logic into the geometry core. Keep geometry operations in standalone TypeScript modules so they can be tested and reused.

## 2. Component hierarchy

```text
App
├── Header
│   ├── FontName / FileStatus
│   └── ExportActions
├── Workspace
│   ├── ControlPanel (left)
│   │   ├── GlyphSelection
│   │   ├── DeconstructionControls
│   │   ├── GeometryGridControls
│   │   ├── DistortionControls
│   │   └── ExportControls
│   └── CanvasViewport (primary area, right)
│   │   ├── GlyphCanvas
│   │   ├── ViewModeToolbar
│   │   └── MetricGuides
├── GlyphStrip / Specimen
├── FileDropTarget
└── StatusBar
```

### Component responsibilities

- **Canvas Viewport:** Draw the selected glyph or specimen, provide zoom and pan, and display guides and edit overlays.
- **Control Panel:** Expose named parameters grouped around designer tasks, with units, ranges, and concise visual descriptions.
- **File I/O:** Validate and parse font files locally; show parse errors and font metadata.
- **Geometry Engine:** Convert parsed outlines into polygon contours and apply resampling, snapping, and distortion.
- **Export Engine:** Serialize the active geometry to SVG or pass a complete set of glyphs to the font builder.
- **Specimen View:** Preview spacing and kerning behavior across characters and strings.

### Source-curve skeleton view

Keep the parsed source outline alongside the derived polygon geometry. In skeleton mode, render the original curve segments, on-curve anchors, off-curve control points, and the handles connecting them. Distinguish these source points visually from the generated polygon vertices so designers can compare the original construction with the deconstructed result. For quadratic font outlines, a segment has one off-curve control point; cubic segments have two.

## 3. Data flow

```text
.ttf / .otf
    │
    ▼
File loader ──► opentype.js
                    │
                    │ glyph commands + metrics
                    ▼
             Geometry adapter
                    │
                    ▼
          Parsed source curves
                    │
                    ├── skeleton overlay (anchors, handles, control points)
                    ▼
          Paper.js Path / contours
                    │
                    ├── flatten curves
                    ├── resample or simplify
                    ├── snap / angle lock
                    └── add vertex displacement
                    │
                    ▼
          Canonical polygon geometry
             │                  │
             ▼                  ▼
      Canvas renderer       Export engine
                          ├── M/L SVG
                          └── Font generation
```

Treat the **canonical polygon geometry** as the source of truth. The canvas and exporters should consume it, rather than each independently recalculating paths. Store font metrics alongside outlines so glyph previews and exports can retain advances and side bearings.

## 4. State and live-update strategy

Separate state into three layers:

1. **Document state:** loaded font, selected glyph, glyph metrics, export metadata.
2. **Parameter state:** curve subdivision count or flatten tolerance, target spacing, snapping, jitter, and display options.
3. **Derived geometry:** processed polygon contours for the selected glyph or specimen.

Keep slider interaction responsive by updating the control state immediately, then scheduling geometry work separately. Use `requestAnimationFrame` to coalesce rapid updates. For larger glyph sets, move recomputation to a Web Worker and send compact typed arrays or serialized contour data.

The live glyph canvas is the primary feedback surface and remains visible while parameters change. Font loading creates an editable preview; it does not generate an output file. Export is a separate, explicit user action. During expensive recomputation, keep the last valid preview visible and indicate pending work rather than replacing the canvas with an export-only result.

Recommended update path:

```text
Slider input → update parameter value → schedule recompute
             → generate derived geometry → update canvas
```

Avoid rebuilding unrelated UI components on every geometry update. Cache geometry by glyph and parameter set where practical. During dragging, the app can render a lower-cost preview and recompute the final-quality geometry when the control settles.

---

# Phase B: Core Vector Algorithms

## 1. Curve elimination: linearization

Font outlines commonly use quadratic or cubic Bézier segments. Linearization approximates each curve with connected straight segments.

In Paper.js, `path.flatten(tolerance)` samples curves until the straight-line approximation is within the chosen geometric tolerance. A smaller tolerance generally produces more segments and a closer approximation; a larger tolerance produces fewer segments and more visible faceting.

The editor should also offer a direct **Lines per curve** control for designers who want to set the number of straight segments used for each original curve. For a curve and requested count `N`, sample it at `t = i/N` for `i = 0…N`, then connect consecutive samples with lines. This is an intuitive, predictable control, while tolerance-based flattening is adaptive: it adds segments where the curve bends more and fewer where it is nearly straight. Present these as selectable modes rather than implying that one slider controls both. In fixed-count mode, allow an optional minimum quality check or warning for curves whose approximation error is visibly high.

```text
Original curve:       Flattened contour:

      ╭───╮           •──•──•
    ╭─╯   ╰─╮          \      \
   ●         ●          •──────•
```

The tolerance should be defined in a clear coordinate system. A practical UI can present it as a design-space or preview-space distance, while the geometry engine converts it to font units. Because glyphs are scaled for display, document whether the control is scale-independent.

After flattening, validate that closed contours remain closed and that the output contains only line segments.

## 2. Resampling and anchor control

Flattening controls approximation error, but does not guarantee evenly spaced or designer-selected anchors. Resampling provides a second control over point distribution.

### Subdivision: adding points

For each line segment:

1. Measure its length.
2. Divide it into intervals no longer than the requested spacing.
3. Insert points at the interval boundaries.

This increases anchor density while keeping points on the current polygon edges.

```text
Before:  A────────────B
After:   A──•──•──•───B
```

Subdivision adds control points; it does not recover curvature removed by flattening.

### Simplification: reducing points

Ramer-Douglas-Peucker (RDP) reduces a sequence of points while keeping the simplified line within a distance threshold of the original. It preserves the overall silhouette but may remove small corners, narrow details, or intentional facets.

Use it after flattening and consider protecting key features such as extrema, corners, or user-pinned anchors. Avoid treating simplification and flatten tolerance as the same control: tolerance governs curve approximation; simplification governs reduction of an existing point sequence.

## 3. Geometric transformations

### Grid snapping

For grid size `g`, round each coordinate to the nearest grid multiple:

```text
x' = round(x / g) × g
y' = round(y / g) × g
```

Grid snapping can create crisp, aligned geometry, but large grid sizes can distort counters and narrow stems. Let designers toggle snapping independently and provide a visible grid in the viewport.

### Angle locking

Angle locking constrains edge direction to a set of allowed angles, such as 0°, 45°, 90°, and 135°. Given an edge vector, calculate its angle, choose the nearest permitted angle, then reconstruct the endpoint while preserving a chosen constraint such as edge length or endpoint position.

The UI should clarify which anchor is fixed during the operation. Otherwise, users may see unexpected movement.

### Vertex offset and noise

Noise displaces vertices to create controlled irregularity. A basic model applies a deterministic offset per vertex:

```text
p' = p + amplitude × noise(seed, vertexIndex, frequency)
```

A **normal bias** controls whether displacement is primarily perpendicular to the contour, along the contour, or a blend. A stable seed makes the shape reproducible across redraws and exports. Without a stable seed, the glyph may appear to change every time the canvas renders.

Apply distortion in a deliberate order. For example:

```text
Flatten → Resample / Simplify → Snap / Angle Lock → Jitter
```

Document the order in the UI or export metadata because these operations are generally not interchangeable.

---

# Phase C: Designer-Developer Coordination & UI Specification

## 1. Shared vocabulary

| Developer term | Designer-facing term | What the control changes |
|---|---|---|
| Flatten tolerance | Curve approximation | Maximum deviation between a curve and its polygon approximation |
| Segments per curve | Lines per curve | Number of straight edges generated from each original curve segment |
| Subdivision step | Anchor spacing / density | Distance between points added along polygon edges |
| Simplification epsilon | Anchor reduction | Amount of geometric detail removed |
| Vertex | Anchor point | Editable point on the glyph contour |
| Contour winding | Path direction | Direction used to describe the outline; relevant to hole interpretation |
| Advance width | Glyph spacing width | Horizontal distance reserved for the glyph in a line of text |
| Side bearing | Left/right margin | Space between glyph outline and its advance box |
| Normal vector | Contour perpendicular | Direction perpendicular to a contour edge |
| Seed | Variation seed | Repeatable starting value for the noise pattern |
| Coordinate units | Font units / design units | Internal measurement system used for outlines and metrics |

Avoid presenting internal library vocabulary directly in the designer interface unless it is accompanied by an explanation.

## 2. Viewport layout and wireframe logic

```text
┌───────────────────────────────────────────────────────────┐
│ Font name · glyph count                         Import Export│
├──────────────────────┬───────────────────────────────────────┤
│ Control panel (left) │ Live canvas viewport (right)          │
│ Glyph selection      │ Source skeleton / current polygon     │
│ Deconstruction       │ Outline / filled rendering            │
│ Geometry and grid    │ Guides and specimen preview            │
│ Distortion / Sound   │ Updates as controls change             │
│ Export options       │                                       │
├──────────────────────┴───────────────────────────────────────┤
│ Preview mode · zoom · selected glyph · processing status      │
└──────────────────────────────────────────────────────────────┘
```

### Outline mode

Show:

- Polygon contours and anchor points.
- Optional vertex indices and contour direction.
- Bounding box, baseline, x-height, cap-height, and ascender/descender guides when available.
- A visible grid when snapping is active.
- Selection state for the current glyph and, later, individual anchors.
- A **Skeleton** overlay showing original on-curve anchors, off-curve control points, and handles; provide a toggle to compare source construction with generated polygon vertices.

Direction vectors can be offered as an optional diagnostic overlay. Name and explain them as contour direction indicators unless users can directly edit them; polygon edges themselves have no Bézier handles.

Use `resources/reference/font_change_sample.png` as the visual reference for a smooth source glyph transitioning into polygonal versions at different detail levels. It informs the live canvas and segment-density control; it is not a pixel-perfect reproduction requirement.

### Fill mode

Show solid filled glyphs for silhouette evaluation. Keep the rendered glyph visible as users edit. Support a single-glyph view and a specimen string view so users can assess rhythm, spacing, counters, and repeated forms. Preserve advances and kerning where the parser and export pipeline support them, and make unsupported font behavior visible.

## 3. Control panel specification

Use compact, high-contrast controls with visible labels, numeric values, and reset actions. Group controls by design intent rather than implementation module.

### Group 1: Deconstruction

- **Flattening mode:** Adaptive curve approximation or fixed lines per curve.
- **Curve approximation:** Flatten tolerance.
- **Lines per curve:** Integer count of straight segments generated for each source curve in fixed-count mode.
- **Anchor spacing:** Target maximum distance between anchors.
- **Anchor reduction:** Optional simplification threshold.
- Include concise effect hints, such as “Lower tolerance follows curves more closely” and “More lines per curve create a closer approximation.”

### Group 2: Geometry & Grid

- **Grid snapping:** On/off.
- **Grid size:** Grid interval in design units.
- **Angle lock:** Off, 45°, or 45° + 90° constraints.
- **Fixed anchor behavior:** Clarify whether an operation holds the first point, centroid, or a selected anchor in place.

### Group 3: Distortion / Jitter

- **Noise amplitude:** Maximum displacement.
- **Noise frequency:** How quickly displacement varies across the contour.
- **Normal bias:** Tangential-to-perpendicular displacement balance.
- **Seed:** Numeric value or reroll button for reproducible variations.
- Keep a clear zero-noise state and a quick reset.

### Group 4: Export Options

- **SVG spec:** Units, viewBox behavior, fill rule, and precision.
- **OTF metadata:** Family name, style, units per em, and naming fields.
- **Font coverage:** Selected glyph, current character set, or all parsed glyphs.
- **Video** (Phase H): Format (MP4 or WebM), Length, Include audio, and Use the preview look; the size line shows the video's pixels, frame rate, and format.
- Show a validation summary before download, including missing or unsupported glyph data.

## 4. Slider-to-formula and design effect mapping

| UI control | Geometry relationship | Typical visual effect |
|---|---|---|
| Curve approximation | Curve-to-segment error threshold | Lower = smoother silhouette, more anchors |
| Lines per curve | Fixed number of line segments per source curve | Higher = closer curve tracing and more vertices |
| Anchor spacing | Maximum segment length after subdivision | Lower = denser, more regularly spaced anchors |
| Anchor reduction | RDP distance threshold | Higher = fewer anchors, more simplified silhouette |
| Grid size | Coordinate quantization interval | Larger = more visibly aligned, more shape change |
| Angle lock | Nearest allowed edge angle | Stronger constraints = more geometric edges |
| Noise amplitude | Maximum vertex displacement | Larger = rougher or more irregular outline |
| Noise frequency | Variation rate along contour | Higher = tighter, more frequent perturbations |
| Normal bias | Blend of tangent and normal displacement | More normal = greater silhouette variation |

---

# Phase D: Step-by-Step Implementation Roadmap

> **Implementation status:** Milestones 1–3 are complete, including the specimen, SVG export, and OTF generation with read-back verification. The geometry pipeline runs only in a Web Worker (`src/geometry/geometry.worker.ts`, `src/state/geometryClient.ts`), with a watchdog and restarts and no main-thread fallback (Phase F). Milestone 4's GitHub Pages workflow is in place (Vite `base` instead of a Webpack public path), and it runs the automated tests before building. Phase F (robustness, saved sessions, undo, and tests) is complete. Phase E (sound-reactive geometry) is in progress: phases 1 (sources, features, meters) and 2 (continuous mappings, live scheduler, live markers, Freeze) are built, and so are, from phases 3 and 4, seeds that jump with the sound, targets that switch themselves on, and 10 features (Pitch and Pan among them); Phase H added Melody as an eleventh feature, letters that react by different amounts, the Response controls, and video recording; see [SOUND_PLAN.md](SOUND_PLAN.md). See “Feature status” in the README.

## Milestone 1: MVP

**Goal:** Prove the end-to-end polygon workflow for a single font and glyph.

- Set up React, TypeScript, and Webpack.
- Add local font file loading and basic error handling.
- Parse a font and select a glyph with opentype.js.
- Convert the glyph outline into Paper.js geometry.
- Flatten curves and render the resulting polygon.
- Export SVG with explicit `M` and `L` commands only.
- Verify exports contain no `C` or `Q` commands and preserve closed contours.

**Acceptance outcome:** A user can load a font and immediately see a live glyph preview, adjust basic flattening in the left panel and see the right canvas update, then explicitly export an SVG.

## Milestone 2: Interactive anchor control and parametric sliders

**Goal:** Make the polygon a responsive design surface.

- Add polygon anchor markers, source-curve skeleton overlay (on-curve anchors, off-curve controls, and handles), and outline/fill display modes.
- Add adaptive flatten tolerance and fixed lines-per-curve modes, plus anchor spacing and simplification controls.
- Add zoom, pan, glyph selection, and specimen preview.
- Separate UI control state from derived geometry.
- Coalesce slider updates; use a Web Worker if profiling shows the main thread is blocked.
- Add reset and reproducible parameter presets.

**Acceptance outcome:** Designers can compare geometry variants and understand how controls affect anchor density and silhouette.

## Milestone 3: Advanced geometry constraints and OTF generation

**Goal:** Expand from SVG output to reusable font output.

- Implement grid snapping and angle locking.
- Add deterministic vertex noise and normal bias.
- Define font-level metadata and glyph coverage choices.
- Build or integrate a font writer that supports polygonal outlines and required font tables.
- Preserve advances, side bearings, contour closure, and hole behavior.
- Validate generated fonts by reopening them with a parser and previewing representative glyphs.

OTF generation requires more than writing paths: the output needs valid glyph records, metrics, naming, character mapping, and other required tables. Confirm the selected font writer supports the intended outline format and browser-side download workflow before committing to the implementation.

**Acceptance outcome:** Users can export a font file with polygonal outlines and retained basic metrics for the supported glyph set.

## Milestone 4: Polish and GitHub Pages deployment

**Goal:** Deliver a stable, coherent tool that works as a static site.

- Apply the dark brutalist / Swiss minimalist visual system.
- Refine typography, spacing, focus states, tooltips, and keyboard access.
- Add empty, loading, error, and export-progress states.
- Test representative fonts with complex contours, holes, and large glyph counts.
- Configure Webpack’s public path for the GitHub Pages repository URL.
- Add a GitHub Actions workflow to build and publish the static app.
- Confirm all file processing and export work without a server.

**Acceptance outcome:** The app deploys to GitHub Pages and supports the documented workflow entirely in the browser.

---

# Phase E: Sound-reactive geometry

> **Implementation status:** in progress. Phases 1 and 2 are built: steps 1 and 2; continuous mappings from step 3 (slider position + Depth × feature, clamped and rounded to the slider's step); step 4 (at most one geometry request in flight, capped at 30 fps, with a separate live cache, and a flash limit on continuous mappings); and from step 5 Source, meters, Sensitivity, Smoothing (now Release), Reset sound, the mapping list with Drive letters, Freeze, live slider markers, and "Live · N fps" in the Sound tab and the status bar. Also built, from phases 3 and 4: 10 features in five groups, with Pitch and Pan (step 2), and the stereo branch they need (step 1); Jump mappings on the three seeds, with Rate and their flash limit, and Beat pulses on sliders (step 3); targets that switch themselves on, 43 in all with the sliders of the reworked Experimental effects, compact meters, live seeds, ten presets with Preset and Load, File as the default source with no Off, and Drive letters as a switch (step 5). Step mappings (Allowed directions, Sides, Rings) from step 3 and measuring the live SVG redraw are not implemented yet; video recording (step 6) was built in Phase H. Phase F (below) made the flash limit one budget shared by the sliders and the seeds, gated Beat against steady bass, made Sound wait while no font is loaded, and saves the mappings between visits. See [SOUND_PLAN.md](SOUND_PLAN.md).

This is the secondary product track (roughly 30% of planned product focus). The Sound tab drives the existing Geometry and Experimental parameters with live sound. It must remain optional, and the font tool must work exactly as before when it is off.

Follow [PRD section 11](PRD.md#11-sound-reactive-geometry-new-product-direction) and the detailed [sound plan](SOUND_PLAN.md).

1. **Audio engine:** File (the default) and Microphone sources through Web Audio, decoded and analysed locally; there is no Off source. The audio context is created inside the first user gesture that needs it and suspended when idle. The microphone starts only on an explicit click and is released on stop.
   - After the 20 Hz high-pass, a stereo measuring branch (an up-mix to two channels, a channel splitter, and two analysers) gives the left and right channels; a mono source reads as centred. The left and right reads are checked against the mixed-down block and read again if the audio thread rendered in between; otherwise the last pair that agreed is held. The speakers and the microphone routing are unchanged.
2. **Features:** pure functions over each analyser frame, 10 in five groups (`FEATURES` in `src/sound/mapping.ts`), merged from the 20 first measured in phase 3 (Phase H adds an eleventh, Melody, in Tone):
   - Loudness: Level (RMS) and Swell (Level smoothed slowly: rise 300 ms, fall 2 s).
   - Bands: Bass / Mids / Treble band energy (20–250 Hz, 250–2000 Hz, 2000 Hz – Nyquist), each against its own recent loudest moment.
   - Tone: Brightness (spectral centroid); Pitch (YIN on the samples decimated to at most 24 kHz, 55 Hz → 0 to 1760 Hz → 1 on a log scale, holding the last note while unvoiced and 0 in silence).
   - Rhythm: Beat (spectral-flux onsets with an adaptive threshold, from two detectors: the whole spectrum and 20–150 Hz for the bass drum; an energy gate lets a detector fire only while one of its octave bands rises at least 2 dB above its loudest of the last 100 ms, so a steady buzzy bass gives no beats), a pulse that jumps to 1 on an onset and falls back with the release time; Activity (the larger of Change, how far the spectral flux rises above its recent median, against the largest such rise lately but never against less than a quarter of the frame's compressed spectrum, so steady sound, noise included, stays near 0; and Pace, Beat onsets a second over the last 2 s, ÷ 8).
   - Stereo: Pan (−1 left to +1 right, the only two-sided feature).
   - A fast attack, an adjustable release, and a silence gate (Swell and Pitch have their own fixed times).
   - Cost: about 90 µs per frame at 48 kHz (about 35 µs before the phase 3 features; unchanged by the merge into 10).
3. **Modulation:** a pure function from slider values, features, and mappings to live parameters, with quantisation to slider steps and clamping. Continuous mappings add Depth × feature to the slider's position (0–1 along the slider as drawn), so a log-scaled slider such as Tolerance moves evenly along its track. Event mappings are Jump (seeds), Step (choices), and Pulse (leap and fall back). All of Sound, sliders and seeds together, is limited to 3 flashes a second by one shared budget (`src/sound/flash.ts`).
   - Jump: the three seeds (Distortion · Seed, Random anchors · Seed, Experimental Seed) are targets of kind `jump` (`src/sound/jumps.ts`). Depth is the Rate (0–100%): with Beat a seed moves on by one on every onset at Rate 100% (50%: every other onset, 25%: every fourth); with any other feature it jumps at up to 4.8 times a second × Rate × the feature's value. Each jump frame takes a large change from the flash budget the driven sliders share: at most 6 in any 1.25 s from sliders and seeds together (all seeds jumping in one frame count once); extra jumps are skipped, so seeds jump less often while sliders are busy. Seeds stay whole numbers in their field's range (0–999 999), wrapping to 0, so every live frame is still a set of values the panel can produce.
   - Pulse: the Beat pulse on any slider.
   - Step: not implemented yet.
   - Each target also says what it needs to act and how to switch that on (`activate`), for the Sound tab's auto-activation.
4. **Live scheduling:**
   - At most one geometry request is in flight, so the frame rate adapts to the cost, capped at 30 fps.
   - A live frame's glyphs are requested first, and the frame goes to React only once they have all arrived (at most 30 times a second), so it renders once, complete.
   - Sound drives only while a font is loaded; without one nothing moves.
   - The pipeline is unchanged; live requests carry a `live` flag so the worker keeps their results apart.
   - Live frames have a separate small cache.
   - The seeds' jumps are counted while Sound can drive. Pausing, stopping, or turning Drive letters off returns the seeds to their fields' values exactly (playing again starts from them); the shared flash budget is kept across that, and the exact restore itself spends one large change from it. Freeze writes the live seeds into the seed fields.
   - Measured in the worker (Arial, 24 distinct glyphs): a seed jump recomputes every glyph in about 2–3.5 ms; Level → Noise amplitude 2.4 ms a frame, three mappings together 12 ms, every Experimental effect on 37–41 ms (24–27 fps). The Experimental figures predate the rework of Crumple, Slipstream, and Thorn, which made each heavier.
5. **UI:** a third tab, **Sound**, with:
   - Source (File or Microphone), meters, Sensitivity, Smoothing (renamed Release and moved into the Response group in Phase H), and the Drive letters switch. The meters are one compact line per feature (label, bar, number) in the five groups, each group with an ⓘ; Pan fills from the centre and reads "L 40" / "R 40" / "C", Pitch reads in Hz, and Beat is a pulse bar in place of the old lights (it still works with reduced motion).
   - A mapping list with presets. The Feature list is grouped like the meters; targets read "Section · Label", or just "Seed" for the Experimental seed; on a seed, Depth reads Rate. Picking a target whose setting is off switches it on and says so under the row ("Turned on Ripple."); nothing is switched off again. A row whose setting was turned off later says why, with Enable. With the keyboard, a target applies on Enter or when focus leaves the list. Add mapping prefers a target that already acts. Choosing in the Preset list only selects; Load resets the Geometry and Experimental settings to their defaults (seeds kept), sets the preset's start values, replaces the mappings with the preset's, and says under the Preset row what it turned off, all as one undo step; an ⓘ lists each preset with one line. The mappings are saved between visits.
   - Freeze and Reset sound.
   - Live markers on the driven sliders, and a small live number beside a driven seed field.
   - "Live · N fps" in the status bar.
6. **Video recording:** built in Phase H (below).

Pipeline:

```text
Audio file / microphone → Web Audio analysers (mixed down; left and right) → 11 features (Loudness, Bands, Tone, Rhythm, Stereo)
Slider values + seeds + features + mappings → live parameters (rounded to slider steps, clamped; seeds moved on by their jumps)
Live parameters → existing geometry pipeline (worker) → canvas        Freeze → slider values and seeds → export
```

Acceptance:
- Synthetic signals give the expected features (`tests/sound`).
- A steady buzzy bass gives fewer than 0.5 beats a second, and kicks over a hum are still found.
- The test track `test-audio/sound-test.wav` (42 s, 16-bit stereo, 44.1 kHz; rendered in memory by `scripts/test-track.ts` and written by `npm run test-track`, not committed) reads as each section should: 0–26 s as before (kick only, kick and hats, a rising chord, silence, a full mix fading, hats at 16 a second), then a single-note melody A2 → A5 and back (26–32 s, Pitch), hats switching hard left and hard right every half second over a quiet centred bass (32–38 s, Pan), and wide uncorrelated noise fading out (38–42 s, Pan stays centred).
- Pausing, stopping listening, turning Drive letters off, switching a mapping off, or setting Depth to 0 restores the slider values exactly; pausing restores the seeds exactly.
- Beat → Distortion · Seed on the test track jumps on every beat of the kick-only part (1.89 a second) and is held to about 4.3–4.5 a second at 8 beats a second.
- Frames stay valid and free of curves, because every letter on screen shows an ordinary parameter set (since Phase H, up to three per frame; since Phase I, up to 15 with Thorn turns).
- The frame rate is measured with each preset.
- Freeze followed by Export reproduces the frozen look.

---

# Phase F: Robustness, saved sessions, and tests

> **Implementation status:** built (branch `feature/robustness-fixes`). Heavy settings and large fonts stay bounded instead of stalling or overflowing; exported fonts keep their kerning and line spacing; a session survives a reload; every setting can be undone; and an automated test suite runs in CI and before each deploy. See "Saving and undo", "Performance", "Export", and "Tests" in the README.

1. **Geometry worker:** the worker's logic moves to `src/geometry/workerCore.ts`, and glyphs are computed only in the worker, never on the page.
   - Every request has an id and ends with done or failed; the worker sends a heartbeat before each glyph; going back to settings whose results are kept cancels the running request.
   - A busy worker silent for 60 s is restarted with the font sent again, and the glyph it was on fails ("Took longer than 60 s; try lighter settings"); after more than 3 restarts within 60 s, geometry stops until another font is loaded.
   - A glyph of superseded settings that has run for 750 ms is abandoned: the worker is replaced at once (at most once every 2 s, never for a live Sound frame).
   - When the worker cannot start, cannot open the font, or keeps failing or going silent, the canvas shows an alert; except for a font the worker cannot open, the alert asks for a reload.
2. **Experimental merge and vertex budget:**
   - The merge of folded outlines rounds a crossing that falls on a cell side exactly (integer arithmetic), tries again on a grid twice as fine when the first result is not clean, and otherwise leaves the outline as it is ("Overlaps could not be merged; the outline is left as it is."). Joining pieces uses an iterative union-find, so a glyph of tens of thousands of points cannot overflow the stack, and a merge with too many vertices and crossings stops early (`maxHot`).
   - Each glyph's Experimental effects may add at most 6,000 vertices and merge at most 30,000 points (`EXPERIMENTAL_LIMITS`, `src/geometry/budget.ts`). Beyond that the outline is simplified (Ramer–Douglas–Peucker, starting at the warp's drift tolerance and doubling up to 12 times), with "Simplified: these settings make too many vertices or crossings, so the outline was reduced (tolerance N u)." in the panel and "(simplified)" in the status bar. A merge over its limit is tried again on a coarser simplification, and left unmerged only when even the coarsest does not fit ("Too complex to merge; lower the settings."). A warp that would make more than 16 times the limit is left out of that glyph ("This glyph is left without crumple: too complex.", and likewise for the other effects). The budget depends only on the glyph and the settings, so the canvas, the preview, and the exported files agree.
3. **Crossing checks and rounding:** a sweep over segments (`SegmentSweep`, turned along y or a diagonal from 64 segments) and an index of each ring's segments by horizontal strips for rings of 128 points or more (`RingIndex`, in the merge) keep the crossing checks fast on long outlines; export rounding checks each contour only against the contours whose boxes come within two rounding steps of it, and treats an outline with more than 2,000 crossings as a tangle, so a star with about 500,000 self-crossings rounds in a fraction of a second.
4. **Font export:**
   - The font is built in its own worker (`src/export/fontExport.worker.ts`), with progress in the dialog, Cancel, and "The export stopped responding." after 60 s without progress; glyphs not yet computed are computed first. The dialog estimates the outline points and warns when the build will be large or slow.
   - Pair kerning from the source (GPOS pair adjustments, or a legacy `kern` table) is written as a GPOS `kern` feature (`src/font/kerning.ts`, `src/export/gpos.ts`).
   - OS/2 version 4 with `USE_TYPO_METRICS`, the typographic metrics equal to the source's `hhea`, so every app that honours that bit spaces lines as the canvas does (the Windows ascent and descent still grow to cover outlines that reach past them, so only apps that ignore it space lines further apart).
   - Font collections (`.ttc` / `.otc`) open with a face menu; switching face keeps the view, and the selected letter when the new face has it.
5. **Preview:** the bottom-right preview is the SVG export itself, drawn small, at the export precision, with a checkerboard for a transparent background and "Export would fail: …" when the export would fail.
6. **Saved session and undo:**
   - Settings, text, Sound mappings, the selected glyph, and the font are saved in `localStorage` (`src/state/persist.ts`) and restored on the next visit; every value is checked on reading, and a visit that closed while drawing restores defaults instead.
   - Undo and redo (`src/state/history.ts`) cover every setting, the text, and the Sound mappings, up to 100 steps; a slider drag, a typing run, a preset Load, and Freeze are one step each, and live Sound frames are never recorded.
7. **Sound:**
   - Beat's energy gate: a detector fires only while one of its octave bands rises at least 2 dB above its loudest of the last 100 ms, so a steady buzzy bass gives no beats.
   - One flash budget (`src/sound/flash.ts`) shared by every driven slider and seed: at most 3 flashes a second in all.
   - Sound drives only while a font is loaded; a live frame's glyphs are requested before it is shown; slider ranges and scales come from one module (`src/state/sliderScales.ts`); microphone errors have their own messages.
8. **Bundle:** React is split into its own chunk, and the Experimental and Sound panels load when first opened.
9. **Tests and CI:** Vitest (`npm test`, the fast suite of 18 files, about 15 s; `npm run test:slow`, every-glyph audits of the fixture fonts and the test track, about 3 minutes). The fixture fonts are STIX Two Text and Roboto (SIL OFL). The test track is rendered by `npm run test-track` instead of being committed. `.github/workflows/test.yml` runs `npm ci`, `npm test`, and `npm run build` on every pull request into and push to `develop`, and the Pages deploy runs `npm test` before building.

Acceptance:
- `npm test` and `npm run test:slow` pass, and `npm run build` type-checks the app, the tests, and the scripts.
- For each sample glyph of the fixture fonts (every glyph in the slow suite), with Experimental off, each effect on its own, all five on plain, dense, and heavy Geometry, and at Anchor spacing 1: deriving never throws and gives the same outline twice, a merged outline has no crossings, rounding at precision 0 and 2 keeps every contour, and the SVG export has only `M`, `L`, and `Z`.
- A comb of 30,000 points crossed 30,000 times merges without a stack overflow; all five Experimental effects at slider maximum trigger the vertex budget and keep the outline bounded and valid, while the defaults, one effect at maximum, and every Sound preset never trigger it.
- An exported font lays out every kerning pair with the same advances as the source, and its line spacing matches the source.
- A collection lists its faces and opens each one the same as the face's own font file.
- A reload restores the settings, the text, and the mappings; a damaged saved session starts from defaults, an older one is read with its old effect and feature names renamed, and out-of-range values are clamped, never causing an error; undo and redo return each step exactly.
- A stuck or failing worker is restarted or reported, never leaving the canvas waiting without a message.
- A steady buzzy bass gives fewer than 0.5 beats a second; sliders and seeds driven together stay within 3 flashes a second.

---

# Phase G: Thorn across the canvas

> **Implementation status:** built (branch `feature/thorn-canvas-reach`, 2026-10-13). Thorn's Reach is a share of the canvas instead of the em, the text is laid out without its thorns, and font files trim glyphs that reach beyond what a font can store instead of leaving them out. See EXPERIMENTAL_PLAN section 4.8 and the PRD's font-export boundaries.

1. **Reach on the canvas:** Reach is a share of the canvas diagonal (0–100%, read as "% canvas", default 10%), so at 100% a thorn can cross the whole canvas; each thorn still goes a seeded 35–100% of it.
   - While Thorn is on, the app gives it the diagonal in em (`canvasDiagonalEm` in `src/geometry/thorn.ts`: the diagonal of the canvas's width and height over the text size, to 0.01 em), so changing the text size or the canvas recomputes the letters only then; the PNG scale does not count. A thorn is at most 256 em long (`THORN_LIMITS.maxReachEm`), and only the tips grow: the root, the base, and the flutes stay measured in em.
   - The slider is cubic (`THORN_REACH` in `src/state/sliderScales.ts`: the cube of the thumb's position, so halfway is 12.5%), so short thorns keep fine steps; near 0 each step adds 0.01% of the canvas until the cube grows faster (up to about 0.28%), so no step rounds to 0 and every arrow key press changes the reach. It reads with two decimals below 1%, one below 10%, and whole numbers above (0.0 only at exactly 0, which grows no thorns); its ⓘ says what 100% is in em at the current text size and canvas. The status bar and export notes read "reach N% canvas (about M em)" in the same format.
2. **Glass and layout:** Refraction covers only the strips over the letter and one either side, so the far ends of thorns reaching left or right are not refracted. Each glyph keeps its box and convex hull from before Thorn (`PolygonGlyph.layoutBox`, `layoutHull`); anchored and Free placement, Fit text, and the overflow warning measure the letters by them (`SpecimenScene.body`; slanted text slants the hull point by point, so it is laid out exactly as with Thorn off), and thorns past the canvas edge are cut off there in the preview and the specimen SVG and PNG, like any ink. While Thorn is on, a glyph catches clicks and Free drags by its advance by the line and an invisible copy of its original outline, while its drawn outline takes none, so a click on a thorn goes to whatever lies behind it (another letter, or the canvas, which pans); without Thorn, glyphs are clicked as before.
3. **Merge:** the grid reaches ±2^22 cells (it was 2^19), enough for 256 em thorns at 4,096 units per em; a glyph beyond it is reported as not merged. A contour narrow on average is left out only where no disk 0.01 em across fits inside it (`OVERLAP_LIMITS.room`), so a letter with very long thin thorns, or a hole with a long thin crack, is kept, while hair-thin slivers still go.
4. **Font export:** each glyph is fitted into a square 32,766 font units across (`src/export/fitGlyph.ts`); parts beyond it are cut off with straight cuts, and the dialog lists the glyph under "Trimmed to fit". An advance above 32,767 units leaves the glyph out with the reason, and verification also checks the head and CFF bounding boxes and the coordinate limits.
5. **Saved sessions and Sound:** sessions are version 2; an older Reach in em becomes the same share of its saved canvas (the diagonal counted as at most 256 em, as Thorn counts it; 4 decimals; a Reach above 0 at least the slider's first step, 0.01%, so Thorn that was on stays on), and Sound rows on Reach keep their depth. Thorn · Reach moves along the cubic slider, and Flare's Level row on Reach goes from 30% to 50%.
6. **Tests:** five new files in the fast suite, now 23 (`tests/geometry/thorn.test.ts`, `tests/export/fitGlyph.test.ts`, `tests/specimen/layout.test.ts`, `tests/specimen/glyphTarget.test.ts`, `tests/state/thornReach.test.ts`), and new cases for far-out merges, thin thorns and cracks the merge keeps, the font export, saved sessions, and Sound.

Acceptance:
- Thorns are 35–100% of Reach × the canvas diagonal long, at most 256 em; reaching 256 em instead of 30 em adds under 10% more points and never sets off the vertex budget.
- Thorns never move, fit, or flag the text, slanted or not, and clicking a thorn away from its letter does not select that letter.
- The merge keeps a letter whose long thin thorns make it narrow on average.
- The Latin sample of both fixture fonts exports with Reach 100% on a 120 em diagonal, nothing left out, and reads back within a font's limits.
- A session saved with Reach in em restores the same length of thorn on its saved text size and canvas.

---

# Phase H: Per-letter sound response, Response controls, and video recording

> **Implementation status:** built (branch `feature/sound-visuals`, 2026-10-14). Each letter can react to the sound by its own amount, six Response controls set how the letters answer the sound, and the canvas can be recorded as a video with its sound. With the Response settings at their defaults, Sound behaves exactly as before. See PRD section 11 and [SOUND_PLAN.md](SOUND_PLAN.md).

1. **Letters** (`src/sound/letters.ts`, pure): each place a glyph appears in the text is a letter, counted in the order the canvas places them (spaces and missing glyphs are counted but never driven). Each letter has a position across the text block (0 at the left, 1 at the right) and a share of the text by its advance.
   - **Motion contrast:** a letter's weight comes from a stable hash of its place and a slow wave (6 s, shifted per letter), so which letters lead drifts every few seconds. At 100% it runs from 1/3.6 to 3.6 times the shared move, balanced around 1: about 17% of the drawn letters are calm, 67% shared, and 17% strong (33, 132, and 34 of the 196 drawn letters of Roboto's default text). Strength sets the overall amount; Motion contrast only spreads it.
   - **Pitch reactive:** the recent melody's low notes weigh the letters on the left more, its high notes those on the right, so a tune sweeps the whole text whatever its register. The pitch is placed in the melody's range (`pitchPlace`), which `features.ts` keeps in each frame (`pitchLow`, `pitchHigh`; `SOUND_LIMITS.melodyRangeAttackMs` 150, `melodyRangeReleaseMs` 8000, `melodyRangeMinSt` 12): it starts as an octave around the first settled note, widens to a new higher or lower note in about 0.15 s, closes in on the last note over about 8 s, starts afresh after 8 s without a note, is always at least an octave wide, and ignores notes within a semitone of either end of Pitch's 55–1760 Hz scale (chords and drums read there). On the first rise through a melody each new highest note sits at the right edge; once the range has been heard, each note gets its own place. It needs a clear single note.
   - **Three levels:** the weights are sorted onto three levels (calm, shared, strong), fixed for a setting, so a steady sound only moves letters onto parameter sets already computed. Together the two controls stay within fixed limits. A letter leaves its level only once its weight is clearly past the boundary (hysteresis), so it does not flicker between two levels.
   - **Every letter a slider value:** a level scales each driven slider's live offset from the slider's own position, then clamps it and rounds it to the step; a result that falls in the slider's own step is exactly the slider's value. Pan keeps its sign. Seeds stay shared by every letter, and Strength scales their Rate. (Since Phase I, while Thorn is on, the Experimental and Random anchors seeds and the other Thorn turn targets come from each letter's turn group instead, unscaled.)
   - **Known limit:** on a slider with few steps, calm and strong letters spread only once the shared value has left the slider's own step.
2. **Flash limit for every letter on screen** (`src/sound/live.ts`, `src/sound/flash.ts`):
   - A slider's move back is the largest of its shared move and the move of each level that some letter shows or is about to. A level is a monotone image of the shared value, so it turns only when the shared value does, and holding the shared value holds every letter.
   - Letters moving between levels: their moves, weighted by each letter's share of the text, are measured from the levels on screen (`switchSwing`) and from those of every frame shown within the last 250 ms (`LIVE_LIMITS.switchSpanMs`), whichever is larger, so a note change that reaches the screen over several frames counts as one change; the trail starts afresh after a move that took from the budget. A move of 10% of the travel or more is a large change, taken from the same budget once per shown frame; when the budget is spent, every letter keeps the level on screen.
   - The levels start afresh when Motion contrast or Pitch reactive changes, when the text changes to a different number of letters, and when Sound stops. Restyling the same text (tracking, line height, alignment, slant) keeps each letter's level.
3. **One request per frame** (`src/geometry/protocol.ts`, `workerCore.ts`, `src/state/geometryClient.ts`):
   - A compute request carries jobs, each a parameter key and its glyphs. A live frame sends its shared values first, for every glyph shown, then the strong and the calm levels' glyphs, all in one request through `prefetchJobs()`; it is committed once all of them have arrived.
   - The worker runs the jobs in order, sends each job's results under its own key, names the key in its heartbeat, and ends with one `done`. The client reuses a request in flight when it already covers every missing (key, glyph) pair.
   - Live results are kept least recently used, at most 6 parameter sets (`LIVE_KEPT_KEYS`; since Phase I, up to 32), so the frame on screen keeps its levels while the next one computes. Only a request's first job gives a glyph the stand-in shape shown while other settings compute.
   - The canvas looks each letter up by its place in the text (`PolygonLookup(index, occurrence)`), and the specimen SVG keys its paths by polygon, so the preview shows each letter's own shape. With every letter on the shared values, the output is byte for byte what it was.
4. **Response controls** (`src/sound/types.ts`, `features.ts`, `mapping.ts`, `jumps.ts`, `mappingStore.ts`, `src/components/SoundControls.tsx`):
   - The Analysis group becomes **Response**: Sensitivity (−24 to +24 dB, step 1), Strength (0–400%, step 5), Motion contrast (0–100%, step 1), Release (20–1000 ms, step 10; it was Smoothing, and the attack stays fixed), Pitch reactive (0–200%, step 5), and Melody tracking (0–200%, step 5). The ranges are in `SOUND_LIMITS` and `RESPONSE_LIMITS`; the defaults are neutral (`NEUTRAL_RESPONSE`).
   - Strength multiplies every slider mapping's sum and every seed's Rate (at most 1). At 0% Sound stops driving and restores the slider values and seeds exactly, and the Mappings group says "Strength is 0%: the letters hold still."
   - **Melody**, a new feature in Tone with its own meter, which can be mapped like any other: a pulse when the pitch moves to a new note at least half a semitone away and holds it briefly. Vibrato, drum hits, and a slide into a note after silence give none, and it falls back with Release. Melody tracking adds half its value × Melody to every slider mapping's feature, except Pan rows, Melody rows, and seeds.
   - The six values are saved in the session as an optional `sound` block (sessions stay at version 2; a session without it reads the defaults) and are undone like the mappings: one drag is one step, and Reset sound, which sets all six back, is one step. Presets leave them alone.
5. **Freeze and status:** Freeze writes the shared values and their held values, already computed, so the switch is instant, and every letter takes them; its hint says so. The slider markers, live seeds, status bar, and the selected glyph's statistics show the shared values; "Live · N fps" counts complete frames, every level included. It is the geometry rate, not how often the sound is read: the sound is read every animation frame, so a hidden or covered tab reads none and the letters stop following the sound until it is shown again. With Motion contrast or Pitch reactive above 0, the slow warning also suggests lowering them.
6. **Video recording** (`src/export/videoFormat.ts`, `drawArtboard.ts`, `recorder.ts`, the engine's audio tap in `src/sound/engine.ts`, `src/components/RecordControls.tsx`, `RecordingCanvas.tsx`, `RecordingIndicator.tsx`, `Header.tsx`, `ExportDialog.tsx`):
   - `videoFormat.ts` (pure, `VIDEO_LIMITS`): the MIME types to try (H.264 High, then Baseline, then any H.264, then the browser's MP4; VP9, then VP8, then the browser's WebM), with MP4 falling back to WebM; the size (the canvas export size, longest side at most 3840 px, area at most 3840 × 2160, even sides); the bitrate (4.5 bits per pixel, 2–12 Mbps, so 10 minutes is about 0.9 GB); the audio delay (the live latency plus 37 ms, 40–400 ms, 90 ms before a frame is measured); the file name; and the clock.
   - `drawArtboard.ts` (pure): draws the scene onto a canvas the way the SVG export draws it: the paper first, always; one nonzero fill per letter, so letters on different levels each show their own shape; slant as a skew; blur through a second layer where the canvas supports filters. `touchCanvas` copies one pixel onto itself, clipped to that pixel, so a canvas that holds still still gives frames.
   - `recorder.ts`: a controller with injected dependencies, and a page singleton with hooks. A take locks its size and MIME types, starts the source when needed (Whole file seeks to 0 with Loop off), and waits for the sound and the first drawn frame (giving up after 30 s). It then captures the canvas (`captureStream` and `requestFrame`) and adds the engine's delayed audio track.
   - A take stops and saves on Stop, at its length, when the sound stops, ends, or switches, when the tab is hidden, when the canvas size changes or the font closes, on a recorder error (what came before is saved), or at 10 minutes. A take that ends at its length, or because the file paused or ended, records the audio delay plus 100 ms more, so the end of the sound reaches the file; after Stop, the 10-minute cap, or the microphone stopping, it records 100 ms more for the last frame; a hidden tab, an error, or a canvas or font change stops it at once. It then gives Loop back and pauses only a source it started.
   - Engine tap: the measured source (the file as heard, or the microphone) goes through a delay into a stream for the recording; the speakers hear no change.
   - UI: the **Record** group at the bottom of the Sound tab (Record or Stop, the elapsed time, Format, Length, Include audio, Use the preview look, the size line, "Live · N fps", and how the last take ended); **Video** in the Export dialog, whose Record closes the dialog and starts the take; and in the header "Starting to record…", "Recording 0:12" with an icon-only Stop, then "Saving the video…", and afterwards how the take ended, with a dismiss button. Freeze is off while recording. The recording canvas sits off screen and exists only during a take. Leaving the page during a take asks first.
7. **Tests:** eight new files in the fast suite, now 31:
   - `tests/sound/neutral.test.ts`, written at commit 4a54e5d before any other change: at the neutral Response settings, `modulate`, the live scheduler's requests, commits, and Freeze, the analyser's readings, and Roboto's default text through to the SVG all hash as before (exactly, the readings to 10 significant digits). The readings' pin was taken again once, from 4a54e5d on x64 and arm64, when CI (Linux x64) showed that V8's `Math.log2` and `Math.log10` differ in the last bit between the two. Since Phase I the scheduler hash leaves out Flare, whose start turns Thorn on, with its pin taken again from 4a54e5d.
   - `tests/sound/letters.test.ts`, `tests/sound/jumps.test.ts`, `tests/specimen/occurrence.test.ts`, `tests/export/specimenPaths.test.ts`, `tests/export/videoFormat.test.ts`, `tests/export/drawArtboard.test.ts`, and `tests/export/recorder.test.ts` (fakes for the clock and timers, the engine, the canvas, MediaRecorder, and the tab's visibility; nothing touches the DOM, and nothing is downloaded).
   - New cases in the flash, live, features, mapping, persist, history, worker, and client tests. Among them: the melody's range (5 cases in the features tests); `pitchPlace` in the letters tests; and in the flash tests an on-screen count that treats a move between levels from any frame shown in the last 250 ms as one change, a 6 Hz octave across the whole range, and real notes through `FeatureExtractor` and the scheduler: with C4 and C5 in turn each C4 ends on the left (the strong letters' mean position below 0.35) and each C5 on the right (above 0.65), every note at Pitch reactive 100% and at least 80% at 200%; the test track's melody at 100% goes from left to right and back on its second pass; both with at most 6 large changes a second. The slow test track checks about one Melody pulse on each of the 11 note changes of its melody section (11, give or take one), and none on the hi-hats before it.
8. **Measured** (Node, one thread, every frame computed afresh, Roboto's default text: 226 letters, 196 drawn, 24 distinct glyphs; median ms a frame):

   | Load | Neutral | Motion contrast 100% | Pitch reactive 200% | Both |
   |---|---|---|---|---|
   | Light (Level → Noise amplitude) | 3.3 | 6.6 | 7.1 | 6.1 |
   | Thorn (Reach and Root) | 15.2 | 30.5 | 29.5 | 25.3 |
   | Flare preset | 6.3 | 13.9 | 16.3 | 15.1 |
   | Crumple, Ripple, Whorl, and Slipstream | 74.7 | 446 | 311 | 503 |

   - Glyph computations a frame: 24 at neutral, 54 to 61 with letters on levels. Keeping track of the levels costs 0.09–0.15 ms a frame.
   - The Pitch reactive column was measured before it followed the melody's range; how a frame is computed has not changed.
   - In the browser, the Jitter preset runs at 30 fps on the test track's kick section; on its hi-hat section, at 23 fps with Motion contrast at 0% and 16–17 fps at 60%.
   - Pitch reactive 100% in headless Chrome (a visible tab, the test track from 25 to 33 s, Roboto's default text, the Jitter mappings): the strong letters' mean position (0 the left end of the text, 1 the right end) at the end of each note, A2 A3 A4 A5 A4 A3, is 0.47 0.83 0.83 0.83 0.64 0.26 on the melody's first pass and 0.15 0.36 0.70 0.82 0.64 0.26 on its second, against 0.22 0.38 0.57 0.72 0.62 0.43 with the pitch on Pitch's whole scale; about 60 animation frames and 13 commits a second. A hidden tab gets no frames, so the letters hold still until it is shown again.

Acceptance:
- `npm run build`, `npm test` (31 files), and `npm run test:slow` pass; the CJK grep prints nothing; every output still has only `M`, `L`, and `Z`.
- `tests/sound/neutral.test.ts` passes on x64 and arm64, so with the Response settings at their defaults Sound gives the same requests, frames, Freeze, readings, and SVG as before (since Phase I, the scheduler's for every preset but Flare).
- Every letter on screen keeps to 3 flashes a second: square waves at Strength 400%, Motion contrast 100%, and Pitch reactive 200%, with the pitch jumping an octave 6 times a second, make at most 6 large changes on screen in any second, while the letters still move. A move between levels that reaches the screen over several frames within 250 ms counts as one change, and real C4 and C5 notes still land on the left and the right within the limit.
- At Motion contrast 60% with Jitter playing, 16–19 glyphs show more than one shape on the canvas, and the preview draws more distinct paths than there are glyphs. Back at 0%, or after Freeze, each glyph has one shape again, the sliders hold the frozen values, and "Updating" never shows.
- 5 s takes in WebM and MP4 at 1200 × 800 are saved with the right size, length, and frames. With MP4 refused, the take is saved as WebM with "MP4 isn't supported in this browser: saved as WebM."
- Export → Video → Record closes the dialog, the header shows "Recording 0:02" with Stop, and Stop saves the take. Hiding the tab stops and saves it with "Recording stopped because the tab was hidden." Recording adds no long tasks, and a canvas that holds still is still recorded as frames.
- Undo brings the Response values back, and Sensitivity, Release, and the four response values survive a reload.

---

# Phase I: Calm thorns and a still text block

> **Implementation status:** built, not merged yet (branch `feature/calm-thorns`, off `develop` at f4483b5, 2026-10-14). While Sound plays, the text block holds still, Thorn keeps its thorns in place through small changes made before it, and with Thorn on the thorns change a few letters at a time. With Thorn off, the live scheduler's requests, commits, and Freeze are exactly as before; only the block's placement now comes from the letters at the slider values. See PRD section 11.

Why: in a screen recording made with Thorn under Sound, the whole block shook and the thorns jumped on every letter at once. Layout measured the live letters' outlines, so seed jumps, letters on levels, and most presets moved the block from frame to frame. Thorn ranked its anchors by their position on the outline after every warp, so one step of Distortion, Crumple, or Ripple, or a new Distortion seed, picked nearly every letter's thorns afresh on every live frame (up to 30 a second), unseen by the flash limit; one Experimental seed jump re-picked every letter together; and levels scaled Reach, so a strong letter's thorns could grow many times longer.

1. **A still text block** (`placementScene` in `src/specimen/artboard.ts`, `src/state/useDerivedGeometry.ts`, `src/components/CanvasViewport.tsx`):
   - While Sound drives the letters, `layoutArtboard` places the block by the slider scene, the letters at the slider values (as shown without Sound), and the live letters are drawn at that place. Lines and pens come from the advances, so both scenes have the same lines; only the box measured on the outlines differs. Sound never moves the block, whatever the effects, seeds, presets, or Response settings.
   - The slider letters usually come from normal editing. When the sliders, text, font, or typography change while live, the glyphs still missing are asked for with `geometryClient.ensure()` once the changes have rested 200 ms (`SLIDER_SCENE_DELAY_MS`): one request per change, not per frame. Until they arrive, the slider letters last set in full for the same shaped text keep the block in place; with none, the live scene places it.
   - The overflow warning measures the slider letters too (`placement`), and `loadSliderScene` (the exports) reuses them once computed.
   - A live letter warped further than its slider shape can reach past the artboard edge: the canvas still shows it, and the preview and a video cut it off there. Freeze changes the slider values, so the block may move once then. Videos draw the same scene at the same place, so they are still too. With Sound off nothing changes.
2. **Stable thorn anchors** (`ThornAnchors` in `src/geometry/thorn.ts`, `src/geometry/experimental.ts`, `pipeline.ts`):
   - `deriveGeometry` gives `applyExperimental` the letter before Distortion (after Flatten or Random anchors, Squaring, Anchor spacing and reduction, Grid snapping, and Angle lock) as Thorn's reference outline. Thorn ranks the candidate anchors there by a hash of the seed, the contour, and the anchor's place, and takes each thorn's direction (the outline's direction over 0.06 em either way, `THORN_WINDOW`), turn, length, and lean from it too.
   - Each pick is followed through Distortion, Crumple, Ripple, Whorl, and Slipstream (and through the budget's simplification and Slipstream's redraw) to the vertex it became, so a thorn still grows from a vertex of the outline as drawn. Its direction goes through the same warps, placed by the ink box as it would be without Distortion, so a Distortion change never re-picks it and turns it only slightly (at most 2.5° in the tests, under Crumple and Ripple); a thorn that would point into the letter as drawn is mirrored out of the ink.
   - Where contours overlap, anchors are picked one by one outside the other contours, 0.1 em clear of them where enough are (`THORN_CLEARANCE`), instead of skipping whole contours: Roboto draws some letters with an arch or bowl over a stem, and none of their anchors counted as outside before.
   - Whorl caches its largest ring step (`largestStep`, which depends only on its arguments), as a warp may now be built twice.
   - The picks for a given seed differ from earlier versions, so an older saved session shows other thorns. Thorn's sliders, ranges, and defaults are unchanged; Anchors still adds or removes thorns at the end of a fixed list and Reach still scales only their length; every output is still `M`, `L`, and `Z` only.
3. **Thorn turns** (`turnGroups`, `ThornTurns`, `turnSets` in `src/sound/letters.ts`; `src/sound/live.ts`; `THORN_TURNS = { groups: 5, gapMs: 250 }` in `src/sound/types.ts`):
   - **Turn targets** (`isTurnTarget`): every target except Distortion's (its seed included) and Crumple's and Ripple's Amount, so Thorn's sliders, the Experimental seed (Crumple and Slipstream re-seed by turns too), every Geometry slider and seed before Distortion (Random anchors' seed included), and the other Crumple, Ripple, Whorl, and Slipstream sliders. While Thorn is on in the live values, they reach the letters by turns, and levels (Motion contrast, Pitch reactive) do not scale them; Thorn's sliders are never scaled, Thorn on or off. Distortion and the two Amounts stay shared and continuous, since the thorns keep through their moves.
   - **Groups:** the drawn letters (as `letterSlots` counts them) form 5 turn groups of whole glyph ids, at most ceil(N / 5) letters each: glyphs go largest first, ties by a hash of the glyph id, to the group with the most room, so each group is spread across the text. Only a glyph that fits whole in no group is split by occurrence. With fewer letters, some groups hold none and pass their turn. The same letters set differently keep their groups.
   - **A turn:** once the last turn has reached the screen and 250 ms have passed, the next group (round robin) takes the live turn state if its own differs: another seed or number of thorns, Thorn switched, a slider half a flash swing away (5% of its travel), or a slider the sound has put back on its own value. While another group differs, a group that does not, or holds no letter, gives its turn up. So the thorns of at most about a fifth of the letters change every 250 ms, and each letter's at most once every 1.25 s.
   - **Flash limit:** a turn whose size (`turnSwing`: the group's share of the text times how far its sliders move, a new seed counting as a whole travel) reaches 10% of the travel takes from the shared budget; refused, it waits, and the group keeps its state.
   - **Starting afresh** (every group takes the live state at once, with no turn charged): when Sound starts driving, when Thorn is switched on, and when the letters of the text change (`sameLetters`: a text edit, or a font or text case that changes the glyphs; the same text restyled keeps its groups). A mapping added or removed reaches the groups by turns. A slider moved by hand that the sound leaves on its own value reaches every group at once.
   - **Frames:** the frame's own parameters stay the shared live values, which the markers, status, and Freeze use. A letter shows its level's values with its group's turn state, so a frame's letters show up to 15 parameter sets (3 levels × 5 groups), and its request always holds the shared set too: up to 16. The shared set is asked for only the glyphs of the letters that show it (and the selected glyph, for its statistics: `FrameJob.within`, `shownGlyphs`), and each other set only for its own glyphs. Every letter is still a result the sliders and seed fields could produce.
   - **Cache:** `LIVE_KEPT_KEYS` rises from 6 to 32. The client keeps twice the most sets of its last four live requests (`LIVE_ASKS`), at least 6 (`LIVE_MIN_KEYS`) and at most 32, so the frame on screen and the one being computed both fit.
   - With Thorn off there are no turns, and the scheduler's output is byte for byte what it was.
4. **Neutral test:** the scheduler hash in `tests/sound/neutral.test.ts` now covers every preset except those whose start turns Thorn on (only Flare, which the test asserts), as Thorn turns change Flare's live frames on purpose. Its pin (`32a8121b`) was taken from the 4a54e5d export, never from the new code, and checked on arm64 and on x64 (the official x64 build of Node 22.23.3 under Rosetta), with the export and with the new code. The other pins are unchanged.
5. **Tests:** three new files in the fast suite, now 34:
   - `tests/geometry/thorn-anchors.test.ts`, on both fixture fonts with the settings from the recording: Distortion amount and seed (with few anchors too) change no pick or direction; one step of Distortion, Crumple, or Ripple keeps at least 90% of the thorns (root within 0.05 em along the outline, direction within 10°) and no letter loses all of them, while a new Experimental seed keeps under 25%; moving Distortion from 46 to 47, 60, or 92 under Crumple and Ripple turns the thorns by at most 0.05° at the median and 2.5° in all; Anchors adds and removes at the end of a fixed list; letters drawn with overlapping contours still grow thorns.
   - `tests/sound/turns.test.ts`: the groups (five of at most ceil(N / 5), spread across the text, whole glyphs where they fit), the turn state and which targets it holds, levels leaving the turn targets unscaled, turns one group at a time 250 ms apart, a refused turn waiting, empty groups passing time, starting afresh, a new mapping coming by turns, Freeze writing the shared values, Thorn off unchanged, and, end to end on the default text with Flare and Level on Distortion, at most a fifth of the letters every 250 ms and a letter at most every 1.25 s.
   - `tests/specimen/placement.test.ts`: the block placed by the slider letters while live, the last slider letters for the same shaped text standing in, and the live scene as the fallback.
   - Changed: `tests/sound/neutral.test.ts` (above) and `tests/worker/geometryClient.test.ts` (two frames of 15 sets are kept, and six sets again once frames are small).
6. **Straight click targets:** since Phase G, a glyph with thorns caught clicks by an invisible copy of the font's curves (`Q` and `C` commands), the one curve left on the canvas. It now catches them by the same outline as Curve flattening draws it (`PolygonGlyph.clickOutline`, set in `src/geometry/pipeline.ts` when Thorn ran), so the canvas holds no curve at all. Clicking behaves as before: the advance by the line and the letter's original shape select it; thorns, and petals or trails the effects drew out of it, do not. The worker's cache counts these points too. `tests/specimen/glyphTarget.test.ts` checks straight segments in every view and petals left to the letters behind them; `tests/geometry/thorn.test.ts` checks the flattened outline whatever Random anchors, Squaring, Anchors, Grid & angles, Distortion, or the effects do. In headless Chrome with the settings below, all 15 letters' click targets were straight, every point sampled just inside a letter's outline selected that letter, and real clicks on thorn tips out on the canvas selected nothing.
7. **Measured:**
   - Node, end to end (EB Garamond at 187 px, "Hello / This is / Ming", neutral Response, a setup like Flare's), before and after: letters' thorns changing went from 283.9 to 7.2 a second (every change of shape, Distortion and the two Amounts included, from 299.7 to 7.4); the most letters' thorns changing in any 250 ms from 15 to 3; the shortest gap between two thorn changes of one letter from 33 to 1331 ms; the block moves 0 px; computing the geometry takes 135 ms of every second instead of 340; no curves.
   - Headless Chrome (Roboto, "Hello / This is / Ming", 15 letters; Thorn with three thorns, Crumple, Ripple, and Distortion; Beat on the Experimental seed and on Thorn's count, Level on Reach and on Distortion's amount; the 42 s test track): one block position over 8 s, at most 3 letters changing in any 250 ms, at least 1533 ms between two changes of one letter, 7.9 changes a second, no curves, Live 30 fps.

Acceptance:
- `npm run build` and `npm test` (34 files) pass; the CJK grep prints nothing; every output still has only `M`, `L`, and `Z`.
- `tests/sound/neutral.test.ts` passes on x64 and arm64: every preset without Thorn gives the same requests, frames, and Freeze as at 4a54e5d.
- While Sound drives the letters, the text block holds still whatever the effects, seeds, presets, or Response settings.
- One step of Distortion, Crumple, or Ripple, or a new Distortion seed, keeps at least 90% of the thorns in place and pointing the same way; a new Experimental seed still picks them afresh.
- With Thorn on, at most about a fifth of the letters change their thorns in any 250 ms, each letter at most once every 1.25 s, within the flash limit.
- The canvas draws and catches clicks with straight segments only: with Thorn on, a letter is clicked by its flattened original outline, never by its thorns.
