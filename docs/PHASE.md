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

The font editor is the primary product and receives roughly 70% of product and design focus. Sound-driven carving is a secondary extension, receiving roughly 30%; it operates on the font editor’s polygon geometry and never gates the core font workflow. This is a planning allocation, not a literal screen-area requirement. The default landing workspace remains the font editor.

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
│ Distortion / carving │ Updates as controls change             │
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

> **Implementation status:** Milestones 1–3 are complete, including the specimen, SVG export, and OTF generation with read-back verification (a Web Worker was not needed). Milestone 4's GitHub Pages workflow is in place (Vite `base` instead of a Webpack public path). Phase E (sound → carving) has not started. See “Feature status” in the README.

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

# Phase E: Sound → Carving Logic → Letterform

> **Implementation status:** planned, not implemented.

This is the secondary product track (roughly 30% of planned product focus). Complete the core font editor milestones first; sound carving extends the existing glyph workflow and must remain optional.

Follow [PRD section 11](PRD.md#11-sound-driven-carved-letterforms-new-product-direction) while extending the existing geometry engine.

1. **Audio/features:** Add AudioSource, AnalysisConfig, and FeatureFrame (timestamp, raw/normalized values, validity, pitch confidence). Decode browser-supported audio locally; analyze RMS, pitch, onsets, duration, band energy, and texture proxies in background work. Retain input fingerprint and analysis version.
2. **Mapping:** Add MappingRule and CarvingParameters with bounds, strength, direction, response curve, smoothing, and toggles. Apply the PRD base/contribution/clamp rules and expose contributions and constraint reasons.
3. **Geometry:** Rebuild base polygons from read-only source glyphs; apply thickness/expansion, terminal extension, notches, roughness, and erosion, then validate closure, counters, winding, and intersections. Version a fixed order and disclose where existing snapping/jitter occur. Define Depth, Pressure, and Width separately to avoid duplicated weight amplification.
4. **Time assignment:** Deliver aggregate-selection mode first, followed by stable arc-length and text-instance assignment. Font contours do not imply a stroke skeleton; extension needs explicit points/directions or a validated detection strategy.
5. **State/performance:** Separate source audio, feature cache, mapping configuration, derived geometry, and recipe. Reject stale jobs using task IDs. Key feature caches by audio fingerprint/configuration and geometry caches additionally by glyph, selection, mapping, seed, and algorithm version.
6. **UI/delivery:** Keep carving controls in the left panel and the live glyph canvas visible on the right. Add audio timeline, feature inspection, mapping editor, source/base/result comparison, validity feedback, and JSON recipes. Live microphone mode is later work and is not required for static audio generation.

```text
Local audio → decode/analyze → raw/normalized features + validity
                            → aggregate/time assignment → contributions → carving parameters
Read-only font → flatten/resample → base polygons → carving → quality validation
                                                           → canonical geometry → preview/SVG/font snapshot
```

Acceptance: independently verify mapping directions, invalid pitch, silence, determinism, cancellation/stale results, complex counters, extreme-parameter constraints, final preview/export equivalence, and recipe replay. Finish static aggregation before temporal assignment; material rendering does not substitute for geometry completion.
