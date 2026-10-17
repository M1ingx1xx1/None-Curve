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
- Phone and tablet layouts: the product is for desktop browsers only, with no narrow-screen layout.

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
- Open font collections (`.ttc` / `.otc`) on a sensible default face (the upright face closest to Regular), and let the user switch faces from the font summary without losing the view or the selected character.
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
  - **Few anchors** (a hidden Distortion mode, set only by the Sound tab's Flicker preset): only a few anchors of each letter move, and the rest stay exactly in place, so the letter keeps its shape.
    - Locked, never moving: corners (where the outline turns by more than 30°), the extremes in x and y (a whole straight top, bottom, or side counts), and every vertex of a contour with fewer than 8 vertices.
    - Candidates: the other vertices, and the midpoint of every straight edge at least 10% of the em long, on any contour of 3 or more vertices. A picked midpoint becomes a new anchor, and the edge's ends stay put, so letters made only of corners and extremes (such as I, l, H, T, or a hyphen) move too.
    - 1–5 movers per letter (6% of its vertices, rounded), at most 2 on one contour, and more than 4 vertices apart along it, picked from the candidates by a hash of the seed and their position. A new seed picks a new set.
    - Each mover is pushed clearly: at least 60% of the amplitude, less only where edge protection or a repair lowers it.
    - While it is on, the Distortion panel shows a read-only note ("Only a few anchors move (set by the Flicker preset in the Sound tab). Reset distortion moves every anchor again.") and an **Anchors moved** statistic. **Reset distortion** turns it off, as does loading another preset.
    - It is not a control and not a Sound target.
- Use a fixed, documented order for geometry operations.

### P1: Fill and specimen preview

- Switch between outline and solid-fill modes.
- Allow users to edit the preview text to inspect repeated glyphs, rhythm, counters, and spacing.
- Preserve advances and kerning when supported by the parser and export pipeline; clearly label when they cannot be retained.
- Provide toggles for available metric guides such as baseline and cap height.
- The small preview beside the text input shows exactly what the SVG export will write: filled outlines at the export's coordinate precision, without the canvas's editing layers, guides, or grid, and a clear message when the export would fail.

### P2: Font-file export

- Let users choose which glyphs to include and enter basic font naming information.
- Generate glyphs with straight-line polygon outlines.
- Preserve advances, side bearings, and character mapping where possible.
- Validate missing glyphs, invalid contours, and unsupported font features before export.
- Inform users about supported scope and features that cannot be preserved.
- Carry the source font's pair kerning between the exported glyphs, and give the file the canvas's line spacing on every platform.
- Store every glyph a font file can hold: one that reaches beyond a font's limits, such as long Thorn tips, is trimmed to fit instead of left out, and the dialog names the glyphs trimmed or left out.
- Build the file in the background so the editor stays responsive, with progress, an up-front estimate of its size (and a warning when it will be too large or slow), and a Cancel that stops the build at once.

### P2: Video export

- Record the canvas as Sound moves it, in real time and with the sound, so the moving letters can be shared. SVG, PNG, and font files keep using the slider values (section 11).
- Write MP4 where the browser can, and otherwise WebM with a note. The video has the canvas export size, as PNG does, and the canvas's own colours or the preview look.
- Start a take from the Sound tab's Record group or from Export → Video. Wherever it started, the header shows its time and a Stop button, and the file is saved when the take ends.
- Record and encode in the browser, with no new dependency; nothing is uploaded.

### P2: Config file

- Export the saved session (settings, view buttons, text, preview look, export precision, Sound mappings and Response, the font's name) as a `.json` file from the Export dialog, with or without a font, and import it again from the Import menu.
- Read it exactly as the saved session is read: marked as the app's, versioned, migrated, and checked leaf by leaf; any other file is refused with a clear message and changes nothing.
- Apply it as one undo step; download a Google font again; name a local font file, which cannot be reopened.

### P2: Experimental effects (stackable)

Creative effects in one **Experimental** tab beside Geometry: **Crumple** (crumpled paper), **Ripple** (waves from a point), and **Slipstream** (letters caught in a stream), built in that order, then **Whorl** (a swirl around each letter's middle) and **Thorn** (a few anchors jumping out into the canvas as thorns). Phase 9 renamed them (they were Noise, Curl, Wind, and Spikes) and reworked Slipstream and Thorn; it reworked Crumple too, but NOCUR-60 brought back Noise's single lattice under the name Crumple. Detailed plan: [EXPERIMENTAL_PLAN.md](EXPERIMENTAL_PLAN.md).

- **No curves, also to the eye:** every effect is built from piecewise-linear warps of the plane. Edges stay straight inside each mesh triangle and bend only at creases, where the only new vertices go. No effect samples a smooth function along the outline, and meshes have a minimum cell size so facets stay visible. Three parts are not warps, and each adds only a few straight edges: Slipstream's trails and cuts, and Thorn's tips.
- **Stackable:** any combination can be on at once. They run after the Geometry pipeline in the fixed order Crumple → Ripple → Whorl → Slipstream → Thorn, each on the previous result.
- **Always valid:** up to 100%, every warp is one-to-one (no mesh triangle flips), so any combination keeps outlines from crossing and counters inside their letters. Contours are still checked after each effect, with reductions reported.
- **Folds for unreadable extremes:** above 100% (Crumple to 500%, Ripple to 400%, Whorl to ±400%, Slipstream Gustiness to 200% with backward gusts, Strength to 800%) the letter may fold onto itself. The overlaps are merged into clean, non-crossing outlines of what the nonzero rule fills, still with straight edges only, so every glyph still exports. The merge redraws each outline through the input's own vertices and exact crossings, so it adds no wobble. Thorns may cross the letter at any setting, so whenever Thorn adds one the outlines are merged the same way; Slipstream's cuts are cut out by the same merge. A merge that breaks down leaves the glyph unmerged (it still fills the same) instead of losing ink, and says so.
- **Bounded cost:** each glyph has a vertex budget that depends only on the glyph and the settings, never on time (at most 6,000 vertices more than it brought into the tab after any effect, and 30,000 more points in a merge). When several dense effects together exceed it, the letter is simplified instead of slowing the page down (with every slider at its maximum it turns into a few broad slabs of ink), and the panel and the status bar say so. The defaults, every single effect, and the Sound presets never reach it.
- **Crumple:** one square lattice of facets (Facet size, 8–100% of the em), turned by the seed, each square split into two triangles along a diagonal the seed picks, so the creases do not line up in a grid. Every lattice point moves by its own random vector from the seed, all turned by Turn, and points in between move with their triangle. Up to 100% it is one-to-one. The lattice is fixed in glyph coordinates, so every copy of a letter crumples alike.
- **Petals:** Ripple can bend its rings into a flower, one straight-edged petal per side (0–300%). Petals is one-to-one at any depth, so it never folds on its own; folding still comes only from Ripple Amount above 100%.
- **Whorl:** rings of straight-sided polygons each turn as a whole about the letter's middle, either with the top and bottom pinned (the middle twists) or as a whole (the top and bottom swing round too). Up to 100% either way it is one-to-one; beyond, it folds like the other effects.
- **Slipstream:** bands across the stream slide past each other like slices (Slip, a shear, so it never folds), the stream draws the letters out from the side facing it (Strength, with gusts), thin wedge-shaped cuts run into the letters along the stream (Cuts), and thin trails stream off their downwind side (Trails).
- **Thorn:** a few anchors on the outside of each letter (counters never grow thorns) jump out into the canvas as long, straight thorns and pull the letter along: a star-shaped mesh around each anchor (Root) makes strokes lean and thin and counters bend toward the thorn, and a sharp tip (Width) finishes it. Anchors sets how many per letter (1–12), Reach how far, and Spread how far they turn aside (up to 90° either way). Reach is a share of the canvas diagonal (0–100%, default 10%), so at 100% a thorn can cross the whole canvas whatever the text size; its slider is curved, so short thorns keep fine control, and only the tips grow with it. Refraction shows the letter through fluted glass, in vertical strips Flute width wide; the glass covers only the letter, so thorn tips reaching past it to the left or right stay sharp. Thorns never move the text: placement, Fit text, and the warning that the text runs past the canvas edge measure the letters without them; thorns may run past the canvas edge, where the preview and the specimen SVG and PNG cut them off like any ink, and clicking a thorn away from its letter does not select that letter. The shared seed picks which anchors jump and where, so Next variant, or a seed driven by Sound, moves them. The anchors and their directions are picked on the letter before Distortion and the other Experimental effects and followed through them, so a step of Distortion, Crumple, or Ripple, or a new Distortion seed, leaves nearly every thorn where it was and pointing the same way; each thorn still grows from a vertex of the outline as drawn.
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
3. **Distortion:** Noise amplitude, frequency, normal bias, and random seed (plus the few anchors mode, which has no control: only the Flicker preset sets it).
4. **Export:** SVG settings, font glyph coverage, font metadata, and the video's options (Format, Length, Include audio, Use the preview look).
5. **Experimental** (its own tab beside Geometry): Crumple, Ripple, Whorl, Slipstream, and Thorn, stackable, with one shared seed.

### Tool hierarchy

- Open on the font deconstruction workspace by default. Font handling, skeleton inspection, outline editing, and export form the primary navigation and canvas.
- Place the control panel on the left and the live glyph canvas in the main area on the right. An exported file must never replace the live preview.
- Offer Sound as a third tab beside Geometry and Experimental. It must not replace the core font editor or require audio input for font editing.
- While Sound is live, sliders keep their own values (a marker shows the live value); switching Sound off restores them exactly. SVG, PNG, and font exports use the slider values; only a video records the moving letters.

### Visual and interaction principles

- Use a dark, high-contrast, minimal visual language that supports outline inspection and form-making.
- Prefer designer-friendly labels such as “Curve approximation,” “Lines per curve,” and “Anchor spacing.”
- Show both a slider and numeric input for key parameters, supporting exploration and precise values.
- Use distinct markers or colors for source skeleton points and polygon vertices.
- Give each core control a short explanation; explain specialized terms in tooltips.
- Cover empty, loading, parsing-error, and export-complete states.
- Support keyboard operation and make focus states easy to see.
- Undo and redo every setting, the text, the Sound mappings, and the Sound tab's Response settings, from the keyboard (⌘Z / ⇧⌘Z on a Mac, Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y elsewhere) and from header buttons; a slider drag is one step, and text fields keep their own undo. A **Reset all settings** button in the status bar puts all of these but the text back to their defaults as one undo step, keeping the font and selected glyph.
- Restore the last session on the next visit: the settings, the text, the Sound mappings and Response settings, and the font (a Google font is downloaded again; a local file must be imported again, and the canvas names it).

### Visual reference for outline transformation

`resources/reference/font_change_sample.png` is the visual reference for the font transformation. It shows a smooth curved glyph becoming polygonal at different levels of detail. Use it to guide the live preview’s transition from source outline to polygon and the visual range of the “Lines per curve / Anchor density” controls. It is not a pixel-perfect target and does not require every font to use the pictured glyph or black-and-white palette.

![Reference showing a curved glyph becoming polygonal at different detail levels](../resources/reference/font_change_sample.png)

## 7. Data and processing rules

- Preserve the original font outlines and metrics as read-only input.
- Store the source-curve skeleton separately from the processed polygon data.
- Derive geometry from the source curves and current parameters; changing parameters must not mutate the original data cumulatively.
- Use an explicit seed for random distortion so previews are repeatable.
- Validate SVG output to ensure path data contains no curve commands such as `C` or `Q`.
- Experimental effects are piecewise-linear warps that add vertices only at creases (Slipstream's trails and cuts and Thorn's tips add a few straight edges); they must not add runs of small same-direction turns that read as curves.
- Avoid blocking the interface when processing large fonts; use background computation when needed and keep controls responsive during processing. Glyph geometry for the canvas is computed only in a background worker, never on the page. A worker that stays silent on one glyph for 60 s is stopped, the glyph is reported as failed, and the worker is restarted; when the worker cannot run at all, the canvas says so and asks for a reload. The font file is built in a worker of its own.
- The saved session (settings, text, mappings, and which font was open) stays in the browser's own storage and is never uploaded. A damaged or older saved session must never break the app: anything that does not fit falls back to its default, and older settings are converted (an older Thorn Reach, in em, becomes the same share of its saved canvas). A config file holds the same session and is read the same way.

## 8. Acceptance criteria

- Users can load a valid `.ttf` / `.otf` (or a face of a `.ttc` / `.otc` collection) and choose a glyph; invalid files produce a clear message.
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
- An exported font keeps the source's pair kerning between the exported glyphs and the canvas's line spacing, and Cancel stops a build at once.
- The preview shows the same outlines as the exported SVG.
- A video recorded from the Sound tab or from Export → Video is saved as MP4, or as WebM with a note where the browser cannot write MP4, at the canvas export size and with the sound. A take ends on Stop, at its length, when the sound stops, or when the tab is hidden, and saves what it recorded.
- Undo and redo bring back settings, text, mappings, and the Sound tab's Response settings; reloading the page restores the last session.
- While Sound drives the letters, the text block holds still whatever the mappings, seeds, presets, or Response settings. With Thorn on, at most about a fifth of the letters change their thorns in any 250 ms and each letter at most once every 1.25 s, and every frame still has straight edges only (`M`, `L`, `Z`).
- Experimental effects can all be on at once; any combination within 100% gives valid outlines (no crossings, counters inside) and adds no curve-like runs, apart from the few known cases listed in EXPERIMENTAL_PLAN section 4.9. Beyond 100%, with thorns, or with Slipstream's cuts, the letters are merged into non-crossing outlines that export. Heavy combinations stay responsive: the vertex budget simplifies the letter instead.
- The fast automated test suite passes on every pull request into `develop` and before every deploy.

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

- **Concept:** a **Sound** tab beside Geometry and Experimental. Live sound, from a local audio file (the default source) or from the microphone after an explicit start, drives the parameters that already exist in both tabs; there is no Off source: Pause stops a file and Stop listening the microphone. The letters move with the music: anchors jump on the beat, outlines crumple when it gets loud, petals open on the bass.
- **No new geometry:** sound only changes parameter values, within each slider's range (a seed: whole numbers within its field's range). Every letter on screen, in every frame, is a result the sliders and seed fields could produce by hand, so it has straight edges only, is validated like every result, and can be exported. Letters may react by different amounts (Response, below), but each letter's shape is still one setting of the sliders. There is no tweening between frames.
- **A still text block:** while Sound drives the letters, the text block holds still. It is placed on the canvas by the letters at the slider values, exactly as without Sound, so no mapping, seed, preset, or Response setting moves it: only the letters change shape where they stand. When the slider values change during playback, the letters at the new values are computed once the sliders rest for 0.2 s, and the block keeps its place until they arrive. After a change of the text, the font, or the typography, the letters at the slider values not computed yet are asked for the same way, and the letters on screen place the block until they arrive. Freeze changes the slider values, so the block may move once then. The warning that the text runs past the canvas edge also measures the letters at the slider values. A letter the sound warps further than its slider shape can therefore reach past the canvas edge: the canvas still shows it, and the preview and a recorded video cut it off there, as they cut off thorns.
- **Features:** 11, in five groups, listed the same way in the meters and in a mapping's Feature list (merged from the 20 first measured in phase 3, plus Melody):
  - **Loudness:** Level (short-time RMS) and Swell (Level followed slowly: it rises over about 300 ms and falls over about 2 s).
  - **Bands:** Bass / Mids / Treble band energy (20–250 Hz, 250–2000 Hz, 2000 Hz – Nyquist), each against its own recent loudest moment.
  - **Tone:** Brightness (spectral centroid); Pitch (the note being played or sung, 55 Hz to 1760 Hz on a log scale; it holds the last note between notes and reads 0 in silence); Melody (a pulse each time the melody moves to a new note at least half a semitone away and holds it briefly, even at a steady loudness; vibrato and drum hits do not count; it falls back with the Release time).
  - **Rhythm:** Beat (onsets from the whole spectrum and from a separate bass-drum detector, counted only while the sound's energy actually rises, so a steady hum or buzzy bass gives no beats), a pulse that jumps to 1 on each onset and falls back with the Release time; Activity (how busy the sound is: the larger of how much the spectrum is changing, near 0 on steady sound, noise included, and high on attacks, and how many beats came in the last 2 s, 8 a second reading 1).
  - **Stereo:** Pan (left −1 to right +1, the only two-sided feature). In practice for files only: a mono microphone reads centred.
  - Most features follow the sound with a fast attack and an adjustable fall time (Release), behind a silence gate; Swell and Pitch have their own fixed times.
- **Mappings:** up to 8 rows, each connecting one feature to one target. They are saved between visits with the settings, and every change to them can be undone; Drive letters is not saved.
  - **Continuous:** slider position (0–1 along the slider as drawn) + Depth × feature, clamped to the slider's ends and rounded to its step; contributions to one target add up before clamping. On an ordinary slider this is slider value + Depth × feature × the slider's range; a log-scaled slider such as Tolerance moves evenly along its track.
  - **Events** (Beat), in three kinds:
    - **Jump:** a seed moves on, so anchors, folds, gusts, cuts, trails, or thorns jump to new places. The three seeds are targets, and a new seed puts every anchor somewhere new (while Thorn is on, a new Experimental or Random anchors seed reaches the letters a group at a time: Thorns by turns, below). On a seed, the row's slider reads **Rate** (0–100%): with Beat the seed moves on by one per onset (Rate 50% is every other onset, 25% every fourth); with any other feature it jumps at up to 4.8 times a second × Rate × the feature's value. Seeds stay whole numbers in their field's range (0–999 999), wrapping to 0.
    - **Step:** the next of a few choices, such as Allowed directions (the angle step).
    - **Pulse:** a leap that falls back. Beat on any slider does this, through its pulse.
  - **Targets in the Geometry tab:** Distortion Seed, Noise amplitude, Noise frequency, and Normal bias; Random anchors Seed, Randomness, and Density; Curve flattening Tolerance, Segments per curve, and Corner angle; Squaring Amount; Anchor spacing and Anchor reduction; Grid size; Allowed directions. Allowed directions comes with Step mappings.
  - **Targets in the Experimental tab:** its sliders and the shared seed. With the Geometry targets, 42 in all.
  - Switches are never targets, nor is Distortion's few anchors mode.
  - **Targets switch themselves on:** picking a target whose setting is off turns that setting on and says so under the row (for example "Turned on Ripple.", "Set Noise amplitude to 40.", or "Turned off Random anchors. Set Mode to Adaptive."). Switching the row to another target, or removing it, never turns anything off. If the user turns the setting off later, the row says why and offers **Enable**. With the keyboard, browsing the Target list applies a target only on Enter or when focus leaves the list; a pick with the mouse applies at once. **Add mapping** prefers a target that already acts.
    - Curve flattening targets turn Random anchors off and set what they need: Tolerance the Adaptive Mode, Segments per curve the Fixed segments Mode, Corner angle Merge joined curves (in either Mode).
    - Grid size turns on Snap to grid.
    - Distortion Noise frequency, Normal bias, and Seed set Noise amplitude to 40 when it is 0.
    - Random anchors targets turn Random anchors on; Seed also sets Randomness to 100% when it is 0%.
    - Experimental effect sliders turn their effect on; Thorn's Flute width also sets Refraction to 50% when it is 0%. The Experimental Seed turns on Crumple when none of Crumple, Slipstream, and Thorn is on (Ripple and Whorl have no randomness).
  - **Presets:** Flicker, Scatter, Pixel, Low poly, Block, Jitter, Facet, Bloom, Flare, Gale. Each sets a few start values as well as its mappings. Most keep to the Geometry tab, so the letters stay readable while it is quiet; at most one Experimental effect each (Bloom Ripple, Flare Thorn, Gale Slipstream). Flicker turns on Distortion's few anchors mode (P1). An ⓘ lists each preset with one line.
    - Choosing one in the **Preset** list only selects it.
    - **Load** resets every Geometry and Experimental setting to its default, keeping the three seeds; sets the preset's start values; replaces the mappings with the preset's; and shows a notice under the Preset row, for example "Loaded Bloom. Turned off Crumple. Other Geometry and Experimental settings back to defaults (seeds kept)." So every preset starts from the same letters, whatever was set before. Load is one undo step that brings back the earlier settings and mappings.
    - Picking a target by hand still only switches on what it needs; it resets nothing.
- **Response:** six sliders in the Sound tab's **Response** group set how the letters answer the sound, over every mapping. At their defaults Sound moves the letters exactly as it did before they existed. They are saved between visits and undone like the mappings (one drag is one step); presets leave them alone, and **Reset sound** sets all six back as one step.
  - **Sensitivity** (−24 to +24 dB, default 0): boosts or cuts the input before measuring, for quiet or loud sources.
  - **Strength** (0–400%, default 100%): scales how far every mapping moves the letters, and every seed's Rate; sliders still stop at their ends. At 0% the letters hold still, and the slider values and seeds come back exactly.
  - **Motion contrast** (0–100%, default 0): each letter, meaning each place it appears in the text, reacts by its own amount. Some stay calm while others move up to 3.6 times as far, and which letters lead drifts every few seconds. At 100% about a sixth of the letters are calm, two thirds move by the shared amount, and a sixth move more. Strength sets the overall amount; Motion contrast only spreads it.
  - **Release** (20–1000 ms, default 150 ms; formerly called Smoothing): how slowly the readings fall back after a sound. They always rise at once.
  - **Pitch reactive** (0–200%, default 0): the low notes of the recent melody move the letters on the left more, its high notes those on the right, so a tune sweeps the whole text whatever its register. The range follows the notes of the last few seconds: it widens to a new higher or lower note within about 0.15 s, closes in on the last note over about 8 s, starts afresh after 8 s without a note, and is always at least an octave wide; notes at the very ends of Pitch's scale, where chords and drums read, are ignored. It needs a clear single note, such as a voice or one instrument.
  - **Melody tracking** (0–200%, default 0): adds the Melody pulse to every slider mapping, so the letters move each time the melody changes note, even at a steady loudness. Pan rows, Melody's own rows, and seeds are left as they are.
  - **Letters at three strengths:** with Motion contrast or Pitch reactive above 0, each letter shows the shared values or a calm or strong level. The levels are fixed for a setting and stay within fixed limits. A level scales each driven slider's live offset from the slider's own value, then clamps it to the slider's ends and rounds it to its step, so every letter is still a value the slider can produce. Seeds stay shared by every letter (while Thorn is on, the Experimental and Random anchors seeds go by turns, below). A letter leaves its level only once its weight is clearly past the boundary, so it does not flicker between two levels.
  - **Thorns by turns:** while Sound drives the letters with Thorn on, the thorns change a few letters at a time. The drawn letters are split into five turn groups, balanced by number of letters and spread across the text (every copy of a glyph in one group, unless it has too many copies to fit). Each letter shows the settings that decide where its thorns sit and which way they point as its group last took them: Thorn's sliders, the Experimental seed (so Crumple and Slipstream re-seed by turns too), every Geometry slider and seed before Distortion (Random anchors' seed included), and every Crumple, Ripple, Whorl, and Slipstream slider except Crumple's and Ripple's Amount. At most every 250 ms the next group in turn takes the current live values, so the thorns of at most about a fifth of the letters change at a time, and each letter's at most once every 1.25 s. Distortion and the two Amounts, which the thorns keep through, stay shared and move continuously. Motion contrast and Pitch reactive do not scale the settings that go by turns, and never scale Thorn's sliders, even with Thorn off. Every group takes the live values at once, with no turn, when Sound starts driving, when the letters of the text change (a text edit, or a font or text case that changes the glyphs; the same text restyled keeps its groups), and when Thorn is switched on; a mapping added or removed reaches the letters by turns, and a slider moved by hand that the sound does not drive reaches every letter at once. Every letter is still a result the sliders and seed fields could produce. With Thorn off, nothing changes.
- **Slider and seed values preserved:**
  - Sliders keep their own values, and a marker shows the live value. Seed fields keep their own seeds, and a small number beside a driven seed shows the live one; the Distortion and Random anchors statistics show the live seed too.
  - Pausing, stopping listening, turning Drive letters off, setting Strength to 0%, switching a mapping off, or setting Depth to 0 restores the slider value exactly. Pausing, stopping, turning Drive letters off, or setting Strength to 0% also returns the seeds to their fields' values exactly, and playing again starts from them.
  - **Freeze** writes the live values into the sliders, and the live seeds into the seed fields, and pauses the sound; it can be undone as one step. When letters react by different amounts or show Thorn settings by turns, Freeze writes the shared values, and every letter then takes them. Freeze is off while a video is recording. Live frames themselves never enter the undo history.
  - SVG, PNG, and font exports always use the slider values, never live audio. A video is the one export that records the moving letters (below).
- **Video:** records the canvas as the sound moves it, in real time, with the sound.
  - A take starts from the **Record** group at the bottom of the Sound tab, or from **Export → Video**, whose Record button closes the dialog and starts it. While it runs, the header shows "Recording 0:12" with a Stop button, wherever it started.
  - **Format:** MP4 or WebM. MP4 is used when the browser can write it; otherwise the take is saved as WebM with "MP4 isn't supported in this browser: saved as WebM."
  - **Length:** Until stopped, 5, 10, 15, 30, or 60 s, or Whole file (the audio file from its start, with Loop off for the take). A file take otherwise starts from the current position; a microphone take starts listening if it was not already.
  - **Include audio** (on by default; with the microphone, its sound goes into the file) and **Use the preview look** (off by default: the canvas's ink and paper; on: the preview's colours and blur).
  - The options are per visit: not saved and not undone.
  - **Size and frame rate:** the canvas export size, as for PNG, scaled down to at most 3840 px on its longest side and 3840 × 2160 in area, in even pixel sizes. The paper is always painted, since a video has no transparency. The frame rate is the live rate, up to 30 fps; the Record group shows "Live · N fps" and warns when it is too slow. A canvas that stands still is still recorded as frames.
  - **Ending:** a take stops and saves on Stop, at its length, when the sound stops, ends, or switches source, when the tab is hidden ("Recording stopped because the tab was hidden."), when the canvas size changes, or when the recorder fails (what was recorded is saved). It stops at 10 minutes. Leaving the page during a take asks first.
  - **Sound:** the file holds the sound as measured (the file, or the microphone), delayed by about as long as the letters take to answer it (measured while Sound runs), so the two line up; what the speakers play does not change.
  - Saved as `Family-Style-video.mp4` or `.webm` (`-video-preview` with the preview look), through the browser's own recorder.
- **Performance:**
  - The pipeline is unchanged, with at most one request in flight; live requests carry a flag that keeps their results apart. A live frame is one request, even when its letters react by different amounts (up to three parameter sets) or show Thorn settings by turns (up to 15: three levels for each of the five turn groups, each set computed only for the glyphs whose letters show it, with the shared values besides). It is shown only once all its glyphs have arrived, so it renders once and complete. The frame rate adapts to the cost, is capped at 30 fps, and is shown in the tab; it counts new shapes, not how often the sound is read. The sound is read every animation frame, so while the tab is hidden or covered it is not read and the letters stop following it until the tab is shown again.
  - Live values are rounded to slider steps so they reuse cached results, and live frames have a separate cache that keeps the most recently used parameter sets: twice as many as the largest of the last four live frames asked for, at least 6 and at most 32.
  - Measuring the first 10 features takes about 90 µs per frame at 48 kHz; Melody follows the Pitch reading. A seed jump recomputes every glyph in about 2–3.5 ms (Arial, 24 distinct glyphs).
  - Letters at different strengths cost more glyph computations per frame. On Roboto's default text (196 letters drawn, 24 distinct glyphs; measured in Node on one thread, every frame computed afresh), Motion contrast 100%, Pitch reactive 200%, or both take a light mapping from 3.3 ms to 6–7 ms a frame, a Thorn setup from 15 ms to 25–31 ms, the Flare preset from 6 ms to 14–16 ms, and four heavy Experimental effects together from 75 ms to 311–503 ms (the Pitch reactive figures were measured before it followed the melody's range, which did not change how a frame is computed; the Thorn and Flare figures before Thorn turns, which did). A steady sound reuses levels already computed. In the browser, the Jitter preset on the test track's hi-hat section runs at 23 fps with Motion contrast at 0% and at 16–17 fps at 60%.
  - Thorns by turns and the still block, measured (PHASE.md, Phase I). In Node, end to end (EB Garamond at 187 px, "Hello / This is / Ming", neutral Response, a setup like Flare's): letters' thorns changing fell from 283.9 to 7.2 a second (every change of shape, Distortion and the two Amounts included, from 299.7 to 7.4), the most letters' thorns changing within 250 ms from 15 to 3, the shortest time between two thorn changes of one letter rose from 33 to 1331 ms, the block moves 0 px, and the geometry takes 135 ms of every second instead of 340. In headless Chrome (Roboto, "Hello / This is / Ming", 15 letters; Thorn with three thorns, Crumple, Ripple, and Distortion; Beat on the Experimental seed and on the number of thorns, Level on Reach and on Distortion's amount; the 42 s test track): one block position over 8 s, at most 3 letters changing in any 250 ms, at least 1533 ms between two changes of one letter, 7.9 changes a second, no curves, and Live 30 fps.
  - Recording draws each frame onto its own canvas without long tasks on the page.
- **Safety:**
  - Against flashing, all Sound mappings together make at most 3 flashes a second: the driven sliders and the seed jumps share one limit of 6 large changes in any 1.25 s. A large change is a slider swinging back by 10% or more of its travel, several sliders swinging back that much together, or a seed jump (seeds jumping in the same frame count once). When the limit is reached, a slider swinging back keeps its last value until it frees up, and a further jump is skipped, so seeds jump less often while sliders are busy. Pausing and playing again does not reset this count.
  - The limit holds for every letter on screen, not only the shared values. A calm or strong letter turns back exactly when the shared value does, so the largest of those swings is what counts, and holding the shared value holds every letter. Letters moving between levels are a large change of their own when, weighted by their width, they move 10% of the travel; a move that reaches the screen over several frames within 250 ms, as a note change does, counts as one change. When the limit is reached, every letter keeps the level it shows. A Thorn turn is a large change of its own when, weighted by its letters' width, it moves 10% of the travel (a new seed counts as the whole travel); when the limit is reached, the turn waits until it frees up.
  - Sound drives the letters only while a font is loaded; without one it waits, and nothing moves.
  - **Drive letters** is an on/off switch. With reduced motion it starts off (and switches off if reduced motion is turned on during the visit), and the Sound tab says why.
  - The microphone starts only on an explicit click and shows an indicator. Each way it can fail (refused, missing, busy, not connected to the analyser, stopped while listening) has its own message.
  - Audio never leaves the browser, and a video is recorded and saved on the user's own computer.
- **Delivery order:**
  1. Audio engine, features, and meters.
  2. Continuous mappings, the live scheduler, and Freeze.
  3. Event mappings, the rate limit, and presets.
  4. Pitch and stereo (Pan).
  5. Per-letter response, the Response controls, and video recording (PHASE.md, Phase H).
  6. Calm thorns and a still text block (PHASE.md, Phase I).

## 12. Implementation status

| Requirement | Status |
|---|---|
| P0 Font loading and glyph preview (including WOFF / WOFF2, `.ttc` / `.otc` collections with a face menu, and Google Fonts) | Implemented |
| P0 Source-curve skeleton | Implemented |
| P0 Curve linearization (adaptive / fixed segments) | Implemented |
| P0 SVG export (current glyph; specimen SVG as well) | Implemented: `M` / `L` / `Z` only, 0–4 decimal places with contour validation |
| P1 Anchor and geometry controls (spacing, simplification, grid, angle, distortion) | Implemented, in a fixed, documented order |
| P1 Fill and specimen | Implemented: editable multi-line text, advance widths and the font's own kerning, missing characters marked on the canvas; the preview draws the SVG export itself |
| P2 Font-file export | Implemented: OpenType (CFF, .otf), selectable glyph range, the source's pair kerning (GPOS) and the canvas's line spacing (`USE_TYPO_METRICS`), built in a worker of its own with progress, a size estimate, and an immediate Cancel, glyphs beyond a font's limits trimmed to fit, verified with fontkit and the browser's font engine after writing |
| P2 Experimental effects | Implemented: Crumple (with Turn), Ripple (with petals), Whorl, Slipstream (with Slip, Cuts, and Trails), and Thorn (with Root and Refraction, Reach measured on the canvas, and anchors picked before Distortion, so small changes of Distortion and the effects before Thorn keep the thorns in place), stackable, with folds beyond 100% and a per-glyph vertex budget |
| P2 Video export | Implemented: real-time recording of the canvas with its sound, as MP4 or WebM (WebM with a note where MP4 is not supported), from the Sound tab's Record group or Export → Video, with a header indicator and Stop; see section 11 |
| Undo, redo, and saved sessions (sections 6 and 7) | Implemented: one history of up to 100 steps for the settings, the text, the Sound mappings, and the Sound tab's Response settings, with **Reset all settings** as one step; the session saved in `localStorage` and restored on the next visit, or exported as a config file (`.json`) and imported again as one undo step |
| Background computation (section 7) | Implemented: geometry only in the worker, with a 60 s watchdog and restarts (a canvas alert when the worker cannot run); font export in its own worker; automated tests in CI |
| Section 11 Sound-reactive geometry | In progress: phases 1–2 built (sources, features, meters; continuous mappings, live scheduler with its own cache, live slider markers, Freeze); from phase 3, Jump mappings on the three seeds with Rate and their flash limit, targets that switch themselves on (42, including the reworked Experimental effects' sliders), and ten presets (Preset and Load, which resets the Geometry and Experimental settings and sets the preset's start values; Flicker's few anchors mode); Pitch and Pan (phase 4) built early, among 10 features in five groups with compact meters; File as the default source with no Off, and Drive letters as a switch; one flash limit shared by sliders and seeds, a Beat that ignores steady bass, and mappings saved between visits; from Phase H, letters that react by different amounts (Motion contrast, Pitch reactive) within the same flash limit, the Response group (Sensitivity, Strength, Motion contrast, Release, Pitch reactive, Melody tracking; saved and undone), Melody as an eleventh feature, and video recording; from Phase I (built, not merged yet), a text block that holds still while Sound plays and thorns that change by turns, a few letters at a time. Not implemented yet: Step mappings (Allowed directions, Sides, Rings) and measuring the live SVG redraw; see [SOUND_PLAN.md](SOUND_PLAN.md) |

Font-export boundaries (answering the open question in section 10): no TTF / WOFF / WOFF2 output; pair kerning between the exported glyphs is exported (GPOS `kern` feature), but contextual and language-specific kerning, ligatures, mark positioning, and other GPOS / GSUB features, hinting, and variation axes are not (a variable font exports the instance shown on the canvas, with the kerning values its variations change rounded to whole units); line spacing is the canvas's (hhea ascender, descender, and line gap, also as the typographic metrics with `USE_TYPO_METRICS`); only glyphs reachable through the character map are exported; characters above U+FFFF are left out because the writer cannot map them reliably; coordinates are rounded to whole font units. Each glyph must fit in a square 32,766 font units across (16 em at 2,048 units per em, 32.8 em at 1,000), along each axis the glyph's own extent where that fits and otherwise centred on its em box, moved where needed to stay within the glyph's extent: outline parts beyond it, such as long Thorn tips, are cut off with straight cuts at its edge instead of the glyph being left out, and the Export dialog lists those glyphs under "Trimmed to fit"; only the font file is trimmed, and the canvas, SVG, and PNG keep them whole. A glyph whose advance is above 32,767 units is left out with the reason, under "Left out of the font file". Read-back verification also checks the head and CFF bounding boxes and that every glyph stays within these limits.
