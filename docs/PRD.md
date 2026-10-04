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
2. The app reads the file locally and displays the font name and available glyphs.
3. The user selects a glyph and inspects its original curve skeleton and generated polygon in outline view.
4. The user chooses adaptive flattening or sets the number of straight segments per original curve.
5. Optionally, the user adjusts anchor density, simplification, grid snapping, angle constraints, and vertex noise.
6. The user switches to filled preview or a specimen string to inspect shape, counters, and spacing.
7. The user exports an SVG of the selected glyph or generates a font file within the supported scope.

## 5. Functional requirements

### P0: Font loading and glyph preview

- Load local `.ttf` / `.otf` files by drag and drop or file picker.
- Process font files in the browser; do not upload them to a server.
- Show the file name, parsing status, and an entry point for glyph selection.
- Show understandable errors for unreadable or unsupported files.
- Provide single-glyph outline view with basic zoom and pan.

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
┌───────────────────────────────────────────────────────────┐
│ Font / file status                            Import Export│
├────────────┬──────────────────────────────┬───────────────┤
│ Glyph      │                              │ Deconstruction│
│ selection  │        Glyph viewport        │ Geometry/Grid │
│            │  Skeleton / Polygon / Fill    │ Distortion    │
│            │                              │ Export options│
├────────────┴──────────────────────────────┴───────────────┤
│ Specimen / preview mode / zoom / processing status         │
└───────────────────────────────────────────────────────────┘
```

### Control groups

1. **Deconstruction:** Flattening mode, curve approximation tolerance, lines per curve, anchor spacing, anchor reduction.
2. **Geometry and grid:** Grid snapping, grid size, angle locking, fixed-anchor behavior.
3. **Distortion:** Noise amplitude, frequency, normal bias, and random seed.
4. **Export:** SVG settings, font glyph coverage, and font metadata.

### Visual and interaction principles

- Use a dark, high-contrast, minimal visual language that supports outline inspection and form-making.
- Prefer designer-friendly labels such as “Curve approximation,” “Lines per curve,” and “Anchor spacing.”
- Show both a slider and numeric input for key parameters, supporting exploration and precise values.
- Use distinct markers or colors for source skeleton points and polygon vertices.
- Give each core control a short explanation; explain specialized terms in tooltips.
- Cover empty, loading, parsing-error, and export-complete states.
- Support keyboard operation and make focus states easy to see.

## 7. Data and processing rules

- Preserve the original font outlines and metrics as read-only input.
- Store the source-curve skeleton separately from the processed polygon data.
- Derive geometry from the source curves and current parameters; changing parameters must not mutate the original data cumulatively.
- Use an explicit seed for random distortion so previews are repeatable.
- Validate SVG output to ensure path data contains no curve commands such as `C` or `Q`.
- Avoid blocking the interface when processing large fonts; use background computation when needed and keep controls responsive during processing.

## 8. Acceptance criteria

- Users can load a valid `.ttf` / `.otf` and choose a glyph; invalid files produce a clear message.
- Users can show the skeleton and identify original anchors, control points, and handles.
- Users can adjust the number of straight segments per curve and immediately see the polygon change.
- Users can switch to adaptive approximation and understand how it differs from fixed segment counts.
- Source skeleton points and generated polygon vertices are visually distinct.
- Exported SVGs contain only straight-line path commands, have closed contours, and display counters correctly.
- The same parameters and random seed produce the same geometry.
- Font loading, preview, and export all run client-side.
- If font export cannot preserve certain features, the app explains this before export.

## 9. Suggested milestones

| Milestone | Deliverables |
|---|---|
| 1. Visual prototype | Font loading, glyph selection, source-curve skeleton, flattening, outline / fill preview, SVG export |
| 2. Anchor controls | Fixed lines per curve, adaptive tolerance, resampling, simplification, live parameter preview |
| 3. Form-making tools | Grid snapping, angle locking, deterministic noise, text specimen |
| 4. Font generation | Font metadata, glyph selection, OTF generation and validation |
| 5. Release polish | Interaction details, accessibility, error states, GitHub Pages deployment |

## 10. Open questions

- What outline types, glyph metrics, and browser-side export features are supported by the chosen parsing and generation libraries?
- How should quadratic and cubic font curves map into a consistent skeleton view?
- Should “Lines per curve” support per-segment values, or use one global value in the first release?
- What are the performance targets for batch processing and large font files?
- What character coverage, font tables, and typesetting features are in scope for the first OTF export?
