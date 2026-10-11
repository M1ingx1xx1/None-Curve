# None-Curve Product Requirements Document (PRD)

**English** · [中文](PRD.zh.md)

**Status:** Draft (see section 12 for implementation status)  
**Product:** Browser-based font outline editor  
**Target users:** Type and graphic designers, creative technologists, frontend developers

## 1. Product overview

None-Curve is a web app for converting curved font outlines into controllable straight-line polygons. Users load a font, inspect its anchors and control points, choose how many straight segments to use when approximating each curve, preview the geometric changes, and export an SVG or font file.

The product is designed for direct, visual exploration. Users should be able to see how the original glyph is constructed and how each setting changes the resulting outline.

## 2. Users and needs

### Primary users

- **Type and graphic designers:** Want to turn existing typefaces into polygonal, faceted, or experimental letterforms and inspect them in outlines and typeset specimens.
- **Creative technologists:** Want repeatable parameters and workflows for generating and comparing font variations.
- **Developers:** Implement font parsing, geometry processing, preview, and file export.

### User goals

1. Load a local font and choose a glyph to inspect.
2. See the original curves, anchors, and control points alongside the generated polygon vertices.
3. Choose how each curve becomes straight segments and compare different levels of detail.
4. Adjust the geometry and preview it as a glyph or in a specimen string.
5. Export an SVG for further design work or, when supported, a font file.

## 3. Product goals and non-goals

### Goals

- Make the relationship between curved outlines and polygon results understandable to non-developers.
- Provide clear, immediate control over the outline, especially the number of straight lines used per curve.
- Support side-by-side inspection of the original curve structure and the processed result.
- Export SVGs made of straight-line outlines, with font-file generation as a progressive capability.
- Perform font loading, editing, and export in the browser.

### Product priority and allocation

- **Font deconstruction and editing is the primary tool, representing about 70% of the overall product focus.** The home and default workspace should prioritize font loading, skeleton inspection, curve linearization, anchor and geometry editing, glyph preview, and export.
- **Sound is a secondary tool, representing about 30% of the overall product focus.** Live sound drives the existing Geometry and Experimental parameters (section 11). The core font tool must remain fully usable when Sound is off.
- The 70/30 split is a product-planning allocation for feature and design effort. It guides interface hierarchy, implementation order, and scope; it is not a strict screen-pixel or session-time ratio.
- Deliver font capabilities before audio features. The audio module must not reduce the discoverability, core editing capabilities, or SVG/font export paths of the font tool.

### Non-goals for the first release

- Replacing a full font drawing or typesetting application.
- Providing a Bézier handle editor or a complete manual glyph drawing tool.
- Redesigning character sets, language coverage, or advanced typesetting features.
- Guaranteeing lossless conversion of every font format, font table, or typesetting feature.

## 4. Core workflow

```text
Load font → Choose glyph → Inspect source skeleton → Set curve-to-line behavior
          → Preview polygons and specimen → Export SVG or font
```

1. The user drops or selects a `.ttf` / `.otf` file.
2. The app reads the file locally and immediately displays a default glyph and glyph selection.
3. The left control panel provides glyph selection and editing controls; the main canvas on the right continuously shows the current rendered glyph.
4. The user inspects the source-curve skeleton and current polygon, then chooses adaptive flattening or sets the number of straight segments per curve.
5. The user adjusts anchor density, simplification, grid snapping, angle constraints, or vertex noise; the canvas updates live with the new parameters.
6. The user switches to filled preview or a specimen string to inspect shape, counters, and spacing in real time.
7. Only when the user explicitly exports does the app generate and download an SVG or supported font file. Loading a font does not trigger export.

## 5. Functional requirements

### P0: Font loading and glyph preview

- Load local `.ttf` / `.otf` files by drag and drop or file picker.
- Process font files in the browser; do not upload them to a server.
- Show the file name, parsing status, and an entry point for glyph selection.
- Show understandable errors for unreadable or unsupported files.
- Provide single-glyph outline view with basic zoom and pan.
- Show a visual glyph preview immediately after loading; loading creates an editable workspace and does not automatically generate or download an output file.

### P0: Source-curve skeleton

- Show the original glyph outline with on-curve anchors, off-curve control points, and handles.
- Allow the skeleton overlay to be toggled.
- Visually distinguish source anchors and control points from the generated polygon vertices.
- Allow users to inspect the source structure and polygon result together.
- The skeleton is read from font outline data. This is for inspection and does not imply direct editing of original Bézier control points.

### P0: Curve linearization

Provide two clearly distinguished modes:

- **Adaptive approximation:** Control the maximum deviation with a curve approximation tolerance. Lower tolerance usually creates more line segments and vertices.
- **Lines per curve:** Let the user set how many straight segments are generated for each original curve. More segments produce a closer approximation.

Update the preview when parameters change. Controls must show their current values and a short explanation of their effect. In fixed-count mode, warn or provide visual feedback when the approximation error is noticeably high.

Keep the rendered result visible on the main canvas while users drag or adjust controls; users must not have to export a file to inspect the shape.

### P0: SVG export

- Export the currently selected glyph as SVG.
- Use only `M` (move) and `L` (line) path commands, and close contours correctly.
- Preserve the contour direction and fill behavior needed to display counters correctly.
- Provide sensible `viewBox` and precision settings.
- Show the glyph and format details before download.

### P1: Anchor and geometry controls

- **Anchor spacing:** Add points along existing polygon edges so the distance between anchors does not exceed a target.
- **Anchor reduction:** Reduce redundant vertices with a simplification threshold while preserving important outline features where possible.
- **Grid snapping:** Align coordinates to a configurable grid; allow it to be toggled.
- **Angle locking:** Constrain edge directions to a set of specified angles.
- **Vertex noise:** Set noise amplitude, frequency, normal bias, and seed. The same seed and parameters must produce the same result.
- Use a fixed, documented order for geometry operations.

### P1: Fill and specimen preview

- Switch between outline and solid-fill modes.
- Allow users to edit the preview text to inspect repeated glyphs, rhythm, counters, and spacing.
- Preserve advances and kerning when supported by the parser and export pipeline; clearly label when they cannot be retained.
- Provide toggles for available metric guides such as baseline and cap height.

### P2: Font-file export

- Let users choose which glyphs to include and enter basic font naming information.
- Generate glyphs with straight-line polygon outlines.
- Preserve advances, side bearings, and character mapping where possible.
- Validate missing glyphs, invalid contours, and unsupported font features before export.
- Inform users about supported scope and features that cannot be preserved.

### P2: Experimental effects (stackable)

Creative effects in one **Experimental** tab beside Geometry: **Noise** (crumpled paper), **Ripple** (waves from a point), and **Wind** (pulled along a direction), built in that order, then **Curl** (a swirl around each letter's middle). Detailed plan: [EXPERIMENTAL_PLAN.md](EXPERIMENTAL_PLAN.md).

- **No curves, also to the eye:** every effect is a piecewise-linear warp of the plane. Edges stay straight inside each mesh triangle and bend only at creases, where the only new vertices go. No effect samples a smooth function along the outline, and meshes have a minimum cell size so facets stay visible.
- **Stackable:** any combination can be on at once. They run after the Geometry pipeline in the fixed order Noise → Ripple → Curl → Wind, each on the previous result.
- **Always valid:** up to 100%, every warp is one-to-one (no mesh triangle flips), so any combination keeps outlines from crossing and counters inside their letters. Contours are still checked after each effect, with reductions reported.
- **Folds for unreadable extremes:** above 100% (Noise to 500%, Ripple to 400%, Curl to ±400%, Wind Gustiness to 200% with backward gusts, Strength to 800%) the letter may fold onto itself. The overlaps are merged into clean, non-crossing outlines of what the nonzero rule fills, still with straight edges only, so every glyph still exports.
- **Petals:** Ripple can bend its rings into a flower, one straight-edged petal per side (0–300%). Petals is one-to-one at any depth, so it never folds on its own; folding still comes only from Ripple Amount above 100%.
- **Curl:** rings of straight-sided polygons each turn as a whole about the letter's middle, either with the top and bottom pinned (the middle twists) or as a whole (the top and bottom swing round too). Up to 100% either way it is one-to-one; beyond, it folds like the other effects.
- **Repeatable:** one shared seed for the tab; effects work in glyph coordinates, so every copy of a letter has the same shape and fonts can be exported.
- Random anchors moves out of "experimental" and stays in the Geometry tab.

## 6. Information architecture and interface requirements

```text
┌──────────────────────────────────────────────────────────────┐
│ Font / file status                              Import Export│
├──────────────────────┬───────────────────────────────────────┤
│ Left control panel   │ Live glyph canvas                     │
│ Glyph selection      │ Source skeleton / current polygon / fill│
│ Deconstruction       │                                       │
│ Geometry and grid    │ Updates immediately when parameters   │
│ Distortion / Sound   │ change                                │
│ Export options       │                                       │
├──────────────────────┴───────────────────────────────────────┤
│ Specimen / preview mode / zoom / processing status           │
└──────────────────────────────────────────────────────────────┘
```

The canvas is the primary feedback area and remains visible during editing. Loading and exporting are separate actions: loading opens a live editing preview; a file is generated only after the user explicitly exports.

### Control groups

1. **Deconstruction:** Flattening mode, curve approximation tolerance, lines per curve, anchor spacing, anchor reduction.
2. **Geometry and grid:** Grid snapping, grid size, angle locking, fixed-anchor behavior.
3. **Distortion:** Noise amplitude, frequency, normal bias, and random seed.
4. **Export:** SVG settings, font glyph coverage, and font metadata.
5. **Experimental** (its own tab beside Geometry): Noise, Ripple, Curl, and Wind, stackable, with one shared seed.

### Tool hierarchy

- Open on the font deconstruction workspace by default. Font handling, skeleton inspection, outline editing, and export form the primary navigation and canvas.
- Place the control panel on the left and the live glyph canvas in the main area on the right. On narrow screens, the left panel may collapse, but an exported file must never replace the live preview.
- Offer Sound as a third tab beside Geometry and Experimental. It must not replace the core font editor or require audio input for font editing.
- While Sound is live, sliders keep their own values (a marker shows the live value); switching Sound off restores them exactly, and exports use the slider values.

### Visual and interaction principles

- Use a dark, high-contrast, minimal visual language that supports outline inspection and form-making.
- Prefer designer-friendly labels such as “Curve approximation,” “Lines per curve,” and “Anchor spacing.”
- Show both a slider and numeric input for key parameters, supporting exploration and precise values.
- Use distinct markers or colors for source skeleton points and polygon vertices.
- Give each core control a short explanation; explain specialized terms in tooltips.
- Cover empty, loading, parsing-error, and export-complete states.
- Support keyboard operation and make focus states easy to see.

### Visual reference for outline transformation

`resources/reference/font_change_sample.png` is the visual reference for the font transformation. It shows a smooth curved glyph becoming polygonal at different levels of detail. Use it to guide the live preview’s transition from source outline to polygon and the visual range of the “Lines per curve / Anchor density” controls. It is not a pixel-perfect target and does not require every font to use the pictured glyph or black-and-white palette.

![Reference showing a curved glyph becoming polygonal at different detail levels](../resources/reference/font_change_sample.png)

## 7. Data and processing rules

- Preserve the original font outlines and metrics as read-only input.
- Store the source-curve skeleton separately from the processed polygon data.
- Derive geometry from the source curves and current parameters; changing parameters must not mutate the original data cumulatively.
- Use an explicit seed for random distortion so previews are repeatable.
- Validate SVG output to ensure path data contains no curve commands such as `C` or `Q`.
- Experimental effects are piecewise-linear warps that add vertices only at creases; they must not add runs of small same-direction turns that read as curves.
- Avoid blocking the interface when processing large fonts; use background computation when needed and keep controls responsive during processing.

## 8. Acceptance criteria

- Users can load a valid `.ttf` / `.otf` and choose a glyph; invalid files produce a clear message.
- Users can see a live glyph preview immediately after loading, without exporting.
- Editing controls are on the left; changing lines per curve or other geometry parameters updates the visible canvas result.
- Users can show the skeleton and identify original anchors, control points, and handles.
- Users can adjust the number of straight segments per curve and immediately see the polygon change.
- Users can switch to adaptive approximation and understand how it differs from fixed segment counts.
- Source skeleton points and generated polygon vertices are visually distinct.
- Exported SVGs contain only straight-line path commands, have closed contours, and display counters correctly.
- The same parameters and random seed produce the same geometry.
- Font loading, preview, and export all run client-side.
- Loading a font does not automatically create a download; export happens only after an explicit user action.
- If font export cannot preserve certain features, the app explains this before export.
- Experimental effects can all be on at once; any combination within 100% gives valid outlines (no crossings, counters inside) and adds no curve-like runs. Beyond 100%, folded letters are merged into non-crossing outlines that export.

## 9. Suggested milestones

| Milestone | Deliverables |
|---|---|
| 1. Visual prototype | Font loading, glyph selection, source-curve skeleton, flattening, outline / fill preview, SVG export |
| 2. Anchor controls | Fixed lines per curve, adaptive tolerance, resampling, simplification, live parameter preview |
| 3. Form-making tools | Grid snapping, angle locking, deterministic noise, text specimen |
| 4. Font generation | Font metadata, glyph selection, OTF generation and validation |
| 5. Release polish | Interaction details, accessibility, error states, GitHub Pages deployment |

**Planning priority:** Keep roughly 70% of product and design effort focused on the font editor. Build the Sound tab (sound-reactive geometry, section 11) as the remaining roughly 30%, after the core font workflow is usable.

## 10. Open questions

- What outline types, glyph metrics, and browser-side export features are supported by the chosen parsing and generation libraries?
- How should quadratic and cubic font curves map into a consistent skeleton view?
- Should “Lines per curve” support per-segment values, or use one global value in the first release?
- What are the performance targets for batch processing and large font files?
- What character coverage, font tables, and typesetting features are in scope for the first OTF export?

## 11. Sound-reactive geometry (new product direction)

Detailed plan: [SOUND_PLAN.md](SOUND_PLAN.md). This replaces the earlier "sound-driven carved letterforms" direction (new carving operators, a timeline, audio spread across the letters of a text, and recipe export), which is dropped.

- **Concept:** a **Sound** tab beside Geometry and Experimental. Live sound, from a local audio file or from the microphone after an explicit start, drives the parameters that already exist in both tabs. The letters move with the music: anchors jump on the beat, outlines crumple when it gets loud, petals open on the bass.
- **No new geometry:** sound only changes parameter values, within each slider's range (a seed: whole numbers within its field's range). Every frame is a result the sliders and seed fields could produce by hand, so it has straight edges only, is validated like every result, and can be exported. There is no tweening between frames.
- **Features:** 20, in six groups, listed the same way in the meters and in a mapping's Feature list:
  - **Loudness:** Level (short-time RMS) and Swell (Level followed slowly: it rises over about 300 ms and falls over about 2 s).
  - **Bands:** Low / Mid / High band energy (20–250 Hz, 250–2000 Hz, 2000 Hz – Nyquist).
  - **Narrow bands:** Sub (20–60 Hz), Bass (60–250 Hz), Low mid (250–500 Hz), High mid (2–4 kHz), Presence (4–6 kHz), and Air (6–20 kHz). Like Low / Mid / High, each reads against its own recent loudest moment.
  - **Tone:** Brightness (spectral centroid); Noisiness (spectral flatness, measured up to the sound's real bandwidth so lossy files read right: notes near 0, hiss and drums high); Pitch (the note being played or sung, 55 Hz to 1760 Hz on a log scale; it holds the last note between notes and reads 0 in silence).
  - **Rhythm:** Beat and Kick (onsets), as pulses that jump to 1 on each onset and fall back with the Smoothing time; Change (how much the spectrum is changing: near 0 on steady sound, noise included, high on attacks); Pace (Beat onsets a second over the last 2 s; 8 a second reads 1).
  - **Stereo:** Balance (left −1 to right +1, the only two-sided feature) and Width (mono 0, wide stereo about 1). In practice for files only: a mono microphone reads centred, with no width.
  - Most features follow the sound with a fast attack and the adjustable release (Smoothing), behind a silence gate; Swell and Pitch have their own fixed times.
- **Mappings:** up to 8 rows, each connecting one feature to one target.
  - **Continuous:** slider position (0–1 along the slider as drawn) + Depth × feature, clamped to the slider's ends and rounded to its step; contributions to one target add up before clamping. On an ordinary slider this is slider value + Depth × feature × the slider's range; a log-scaled slider such as Tolerance moves evenly along its track.
  - **Events** (Beat, Kick), in three kinds:
    - **Jump:** a seed moves on, so anchors, folds, or gusts jump to new places. The three seeds are targets, and a new seed puts every anchor somewhere new. On a seed, the row's slider reads **Rate** (0–100%): with Beat or Kick the seed moves on by one per onset (Rate 50% is every other onset, 25% every fourth); with any other feature it jumps at up to 4.8 times a second × Rate × the feature's value. Seeds stay whole numbers in their field's range (0–999 999), wrapping to 0.
    - **Step:** the next of a few choices, such as Allowed directions (the angle step).
    - **Kick:** a leap that falls back. Beat or Kick on any slider does this, through their pulses.
  - **Targets in the Geometry tab:** Distortion Seed, Noise amplitude, Noise frequency, and Normal bias; Random anchors Seed, Randomness, and Density; Curve flattening Tolerance, Segments per curve, and Corner angle; Squaring Amount; Anchor spacing and Anchor reduction; Grid size; Allowed directions. Allowed directions comes with Step mappings.
  - **Targets in the Experimental tab:** its sliders and the shared seed.
  - Switches are never targets.
  - **Targets switch themselves on:** picking a target whose setting is off turns that setting on and says so under the row (for example "Turned on Ripple.", "Set Noise amplitude to 40.", or "Turned off Random anchors. Set Mode to Adaptive."). Switching the row to another target, or removing it, never turns anything off. If the user turns the setting off later, the row says why and offers **Enable**. With the keyboard, browsing the Target list applies a target only on Enter or when focus leaves the list; a pick with the mouse or a finger applies at once. **Add mapping** prefers a target that already acts.
    - Curve flattening targets turn Random anchors off and set what they need: Tolerance the Adaptive Mode, Segments per curve the Fixed segments Mode, Corner angle Merge joined curves (in either Mode).
    - Grid size turns on Snap to grid.
    - Distortion Noise frequency, Normal bias, and Seed set Noise amplitude to 40 when it is 0.
    - Random anchors targets turn Random anchors on; Seed also sets Randomness to 100% when it is 0%.
    - Experimental effect sliders turn their effect on. The Experimental Seed turns on Noise when neither Noise nor Wind is on (Ripple and Curl have no randomness).
  - **Presets:** Anchor jump, Resample, Bass bloom, Shiver, Whirl, Gale, Grid pulse, Low poly, Drift. Choosing one in the **Preset** list only selects it; **Load** replaces the mappings with the preset's and switches on what their targets need, as picking a target does. An ⓘ lists each preset with one line.
- **Slider and seed values preserved:**
  - Sliders keep their own values, and a marker shows the live value. Seed fields keep their own seeds, and a small number beside a driven seed shows the live one; the Distortion and Random anchors statistics show the live seed too.
  - Switching Sound off, switching a mapping off, or setting Depth to 0 restores the slider value exactly. Pausing, stopping, or turning Drive letters off returns the seeds to their fields' values exactly, and playing again starts from them.
  - **Freeze** writes the live values into the sliders, and the live seeds into the seed fields, and pauses the sound.
  - Exports always use the slider values, never live audio.
- **Performance:**
  - The pipeline is unchanged, with at most one request in flight; live requests carry a flag that keeps their results apart. The frame rate adapts to the cost, is capped at 30 fps, and is shown in the tab.
  - Live values are rounded to slider steps so they reuse cached results, and live frames have a separate cache.
  - Measuring the 20 features takes about 90 µs per frame at 48 kHz. A seed jump recomputes every glyph in about 2–3.5 ms (Arial, 24 distinct glyphs).
- **Safety:**
  - Against flashing, a driven slider swings back and forth by 10% or more of its travel at most 3 times a second; a further swing keeps the slider's last value until the 1.25 s window has passed. Seed jumps get the same limit, counted the same way: at most 6 jump frames in any 1.25 s, so 3 flashes a second (seeds jumping in the same frame count once); a further jump is skipped. Pausing and playing again does not reset this count.
  - With reduced motion, Drive letters starts off (and switches off if reduced motion is turned on during the visit), and the Sound tab says why.
  - The microphone starts only on an explicit click and shows an indicator.
  - Audio never leaves the browser.
- **Delivery order:**
  1. Audio engine, features, and meters.
  2. Continuous mappings, the live scheduler, and Freeze.
  3. Event mappings, the rate limit, and presets.
  4. Pitch and Balance.

  Video recording comes later.

## 12. Implementation status

| Requirement | Status |
|---|---|
| P0 Font loading and glyph preview (including WOFF / WOFF2 and Google Fonts) | Implemented |
| P0 Source-curve skeleton | Implemented |
| P0 Curve linearization (adaptive / fixed segments) | Implemented |
| P0 SVG export (current glyph; specimen SVG as well) | Implemented: `M` / `L` / `Z` only, 0–4 decimal places with contour validation |
| P1 Anchor and geometry controls (spacing, simplification, grid, angle, distortion) | Implemented, in a fixed, documented order |
| P1 Fill and specimen | Implemented: editable multi-line text, advance widths and the font's own kerning, missing characters marked |
| P2 Font-file export | Implemented: OpenType (CFF, .otf), selectable glyph range, verified with fontkit and the browser's font engine after writing |
| P2 Experimental effects | Implemented: Noise, Ripple (with petals), Curl, and Wind, stackable, with folds beyond 100% |
| Section 11 Sound-reactive geometry | In progress: phases 1–2 built (sources, features, meters; continuous mappings, live scheduler with its own cache, live slider markers, Freeze); from phase 3, Jump mappings on the three seeds with Rate and their flash limit, targets that switch themselves on, and nine presets (Preset and Load); Pitch and Balance (phase 4) built early, with 20 features in all and compact meters. Not implemented yet: Step mappings (Allowed directions, Sides, Rings) and measuring the live SVG redraw; see [SOUND_PLAN.md](SOUND_PLAN.md) |

Font-export boundaries (answering the open question in section 10): no TTF / WOFF / WOFF2 output; kerning and other GPOS / GSUB features, hinting, and variation axes are not exported (a variable font exports the default instance shown on the canvas); only glyphs reachable through the character map are exported; characters above U+FFFF are left out because the writer cannot map them reliably; coordinates are rounded to whole font units.
