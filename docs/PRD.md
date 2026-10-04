# None-Curve Product Requirements Document (PRD)

**Status:** Draft  
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
- **Sound-driven carving is a secondary tool, representing about 30% of the overall product focus.** It extends polygon editing with audio analysis, parameter mapping, and carving effects. The core font tool must remain fully usable when the audio module is off.
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

## 6. Information architecture and interface requirements

```text
┌──────────────────────────────────────────────────────────────┐
│ Font / file status                              Import Export│
├──────────────────────┬───────────────────────────────────────┤
│ Left control panel   │ Live glyph canvas                     │
│ Glyph selection      │ Source skeleton / current polygon / fill│
│ Deconstruction       │                                       │
│ Geometry and grid    │ Updates immediately when parameters   │
│ Distortion / carving │ change                                │
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

### Tool hierarchy

- Open on the font deconstruction workspace by default. Font handling, skeleton inspection, outline editing, and export form the primary navigation and canvas.
- Place the control panel on the left and the live glyph canvas in the main area on the right. On narrow screens, the left panel may collapse, but an exported file must never replace the live preview.
- Offer sound carving as an optional tool or workspace mode for the current glyph. It must not replace the core font editor or require audio input for font editing.
- When sound is active, retain comparison access to the source glyph, base polygon, and sound-driven result.

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

## 9. Suggested milestones

| Milestone | Deliverables |
|---|---|
| 1. Visual prototype | Font loading, glyph selection, source-curve skeleton, flattening, outline / fill preview, SVG export |
| 2. Anchor controls | Fixed lines per curve, adaptive tolerance, resampling, simplification, live parameter preview |
| 3. Form-making tools | Grid snapping, angle locking, deterministic noise, text specimen |
| 4. Font generation | Font metadata, glyph selection, OTF generation and validation |
| 5. Release polish | Interaction details, accessibility, error states, GitHub Pages deployment |

**Planning priority:** Keep roughly 70% of product and design effort focused on the font editor. Build sound-driven carving as the remaining roughly 30%, after the core font workflow is usable, in the separate sound-to-letterform track below.

## 10. Open questions

- What outline types, glyph metrics, and browser-side export features are supported by the chosen parsing and generation libraries?
- How should quadratic and cubic font curves map into a consistent skeleton view?
- Should “Lines per curve” support per-segment values, or use one global value in the first release?
- What are the performance targets for batch processing and large font files?
- What character coverage, font tables, and typesetting features are in scope for the first OTF export?

## 11. Sound-driven carved letterforms (new product direction)

### Concept and scope

Use **Sound → Carving Logic → Letterform**: extract explainable audio features, map them to carving parameters, then modify polygon glyph contours. Each deformation must be traceable to its input. This is an optional extension of the existing polygon workflow. Carving is a design model, not a physical simulation: normalized Depth controls contour expansion and notch amplitude. Two-dimensional SVG and fonts do not contain physical depth; material shading must remain distinguishable from exported geometry.

### Audio features

- First release: local WAV and browser-decodable MP3, playback, timeline, and selection. Microphone input is a later, explicitly activated extension. Decode and analyze locally; expose invalid, empty, silent, and unsupported input states.
- **Volume:** short-time RMS energy, not calibrated physical sound pressure.
- **Pitch:** fundamental-frequency estimate in Hz with confidence; unvoiced or low-confidence frames must not trigger high-pitch effects.
- **Rhythm:** onsets, inter-onset intervals, and events per second; show estimated BPM only when a stable beat can be inferred.
- **Duration:** selection and continuous-event length in seconds, separate from integrated energy.
- **Frequency:** relative low/mid/high band energy, distinct from Pitch. Initial boundaries: 20–250 Hz, 250–2000 Hz, and 2000 Hz–Nyquist, clipped to the valid range for the sample rate.
- **Texture:** spectral flatness, a noise-proportion proxy, and transient variation; describe these as acoustic estimates, not material recognition.
- Retain raw values, units, normalized values, timestamps, and validity. Record normalization ranges, silence threshold, window, and hop size; handle zero denominators and clamp outliers.

### Default mappings

| Audio input increases | Carving logic | Letterform effect |
|---|---|---|
| Volume | Greater Depth and Pressure | Deeper notches, stronger contour expansion, heavier weight |
| Confident Pitch | Sharper Chisel Angle, lower Stroke Width | Sharper terminals, narrower local strokes |
| Relative low-band energy | Greater Pressure and Stroke Width | Heavier, horizontally wider forms |
| Rhythm / onset density | Greater notch density | Denser cuts and fragmented local strokes without disconnecting whole strokes by default |
| Event Duration | Greater carving extension | Longer designated terminals or local strokes |
| Texture noise estimate | Greater Edge Roughness and Erosion | Rougher edges and more visible loss of material |
| Relative high-band energy | Denser, sharper small cuts | Finer edge details, independently of fundamental pitch |
| Transient strength | Local Pressure peaks | Stronger chisel marks at corresponding event positions |

Define six separate operators: Depth sets notch amplitude; Pressure sets local expansion and influence radius; Stroke Width sets thickness; Edge Roughness sets edge disturbance; Erosion subtracts missing regions; Chisel Angle sets notch angle and orientation. They must not all reduce to the same random vertex displacement. These are editable design defaults, not acoustic laws.

### Mapping and temporal controls

- Each mapping exposes feature, target, input range, output bounds, strength, direction, response curve (linear/ease-in/ease-out), toggle, and reset. Show contributions when multiple features affect one target.
- Compose as base value + mapping contributions → output clamp → geometry constraints. Zero strength restores base values; disabling the module restores the existing geometry workflow.
- Default to aggregate features from a selection for a static glyph. Extended modes distribute time across text characters or contour arc length. Label the active mode and define stable contour order/start points, spaces, punctuation, repeated characters, and audio shorter than text.
- Repeated text characters may have instance-specific outlines. Fonts normally have one glyph per character: export instance variation as specimen SVG and require an explicitly selected static snapshot for font output.
- Smooth continuous features while retaining onset events. Allow parameter locks and frozen selections/time points, plus source/base polygon/audio-driven comparison.
- Identical audio, selection, analysis settings, mappings, base geometry, seed, and algorithm version produce identical static geometry. Playback and redraw must not reroll randomness.

### Quality, interaction, and export

- Enable a readability mode by default, with minimum stroke thickness and counter gap, maximum extension, and erosion proportion in em/font units, independent of viewport zoom.
- Check closure, winding, counters, degenerate edges, and self-intersections. Reduce effects or restore recent valid geometry with a specific explanation; block export of unresolved invalid output.
- Erosion must change contours with valid hole/fill behavior. Rendered shadows alone do not establish a change in glyph depth.
- Preserve advances and baseline by default and flag margin overflow. Optional adaptive advances must be explicit and identical in preview and export.
- Timeline: waveform, selection, onsets, and selected feature curves. Controls: Sound / Carving / Letterform, input validity, contributions, and constrained states. Provide undo/redo, reset, and preset import/export without embedding source audio by default.
- Prioritize static generation. Show analysis/generation progress; cancellation and changed inputs must prevent stale jobs from overwriting newer results.
- Export a valid glyph SVG, time-assigned text specimen SVG, and JSON recipe with analysis/mapping settings, selection, seed, and algorithm version. Recipes require relinking audio and checking a content fingerprint. Continue straight-line contour and font validation requirements; do not describe 2D exports as 3D models.

### Acceptance and delivery

Test silence, stable high/low tones, strong/weak amplitudes, dense/sparse onsets, long/short events, and noise independently. Hold other inputs fixed to verify mapping direction; invalid Pitch produces no sharpening. Low-band energy and fundamental pitch must independently affect weight and sharpness. Verify zero/disabled/reversed/clamped mappings, repeatability, preview/export equivalence, and valid readable output on counters, thin strokes, complex Chinese glyphs, and repeated-character specimens.

Delivery order: local audio analysis → static aggregate mappings → distinct carving operators and quality constraints → temporal contour/text assignment → recipe and specimen export. Evaluate live microphone input later.
