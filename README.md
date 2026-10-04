# None-Curve

**English** · [中文](README.zh.md)

An experimental web app for turning font curves into editable polygon shapes. Load a font, type some text, and watch every letter rebuilt from straight lines as you adjust the controls. Make outlines faceted, square, snapped to a grid, or roughened, then export a glyph or your text as SVG, or the glyphs as an OpenType font. Everything runs in your browser; fonts are never uploaded.

**New here and not a developer?** Read the **[User Guide](docs/USER_GUIDE.md)** — it explains every part of the screen and every control in plain language.

![From curved letterforms to polygons at different levels of detail](resources/reference/font_change_sample.png)

## Feature status

| Feature | Status |
|---|---|
| Import local fonts (.ttf / .otf / .woff / .woff2) and Google Fonts, including pasted Google Fonts links | ✅ Implemented |
| Glyph list, original-curve skeleton, Original / Flattened / Compare views | ✅ Implemented |
| Curve flattening (adaptive or fixed segments, with optional curve merging) | ✅ Implemented |
| Squaring (round O → square O), anchor spacing and reduction, grid snapping, angle lock, deterministic distortion | ✅ Implemented |
| Live text preview with advance widths, kerning, multiple lines, and missing-character marks | ✅ Implemented |
| SVG export of the selected glyph or the text | ✅ Implemented |
| OpenType font export (CFF, .otf), verified after writing | ✅ Implemented — see [limits](#font-file) |
| TTF / WOFF / WOFF2 output; exporting kerning and OpenType features | ❌ Not supported |
| Sound → Carving Logic → Letterform | ⏳ Planned, not implemented |

## Documentation

| Document | English | 中文 |
|---|---|---|
| User Guide (for designers, no code) | [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | [docs/USER_GUIDE.zh.md](docs/USER_GUIDE.zh.md) |
| Product requirements | [docs/PRD.md](docs/PRD.md) | [docs/PRD.zh.md](docs/PRD.zh.md) |
| Implementation plan | [docs/PHASE.md](docs/PHASE.md) | [docs/PHASE.zh.md](docs/PHASE.zh.md) |
| Project conventions | [docs/BEST_PRACTICE.md](docs/BEST_PRACTICE.md) | [docs/BEST_PRACTICE.zh.md](docs/BEST_PRACTICE.zh.md) |

## Running the app

- **Online:** `https://m1ingx1xx1.github.io/None-Curve/` once the `main` branch is deployed (see [Deploy to GitHub Pages](#deploy-to-github-pages)).
- **Locally:** requires Node.js 20.19 or newer (22 recommended).

```bash
npm install       # install dependencies
npm run dev       # development server: http://localhost:5173/
npm run build     # type check + production build into dist/
npm run preview   # preview the production build: http://localhost:4173/None-Curve/
```

## Interface

```text
┌────────────────────────┬──────────────────────────────────────┐
│ Tools                  │ Result canvas                         │
│ Import · font info     │ shows only the input text             │
│ Parameters (scroll)    │                                       │
├────────────────────────┼──────────────────────┬───────────────┤
│ Glyphs                 │ Text input           │ Glyph preview │
└────────────────────────┴──────────────────────┴───────────────┘
```

- **Top left — tools:** **Import font** and the font information come first, followed by every geometry parameter (flattening, squaring, anchors, grid & angles, distortion, export) in pipeline order. Parameter statistics refer to the selected glyph.
- **Top right — result canvas:** shows only the text from the input, set with the current font and all parameters. Its outline and layer controls (Original / Flattened / Compare, Fill, Skeleton, Vertices, Metrics) also drive the glyph preview; zoom and pan apply to the canvas only. Clicking a glyph in the canvas selects it.
- **Bottom left — glyphs:** the searchable glyph grid (characters or all glyphs). Selecting a glyph shows it in the preview; it never changes the text or the canvas view.
- **Bottom right — input and preview:** a compact multi-line text input (sample texts in a menu, Clear, character count, kerning status, missing characters) on the left, and a small preview of the selected glyph on the right with its own zoom, pan, and **Fit**.
- Narrow screens stack: import and font info, the canvas (at least 62 % of the viewport height), parameters (collapsed; **Parameters** in the canvas toolbar opens them), text input, glyph preview, then the glyph list.

### Canvas

- Outline view: **Original** (font curves), **Flattened** (final polygon), **Compare** (final polygon with the original curves overlaid as a dashed line). The current view is shown in the canvas corner and the status bar.
- Layers: **Fill** (off = outline stroke), **Skeleton** (original on-curve anchors as squares, off-curve controls as hollow circles, and handles; TrueType's implied on-curve points appear as anchors), **Vertices** (final polygon vertices as green dots), and **Metrics** (ascender, cap height, x-height, baseline, descender, advance width).
- Zoom with the mouse wheel or `+` / `−`, pan by dragging or with the arrow keys (canvas focused), `0` or **Fit** to reset. The glyph preview has its own zoom and pan with the same gestures.
- All layers apply to every glyph of the text. Only glyphs inside the visible area are drawn. Skeleton points and vertices appear once an em is at least 48 px on screen; below that the canvas asks you to zoom in, so long texts stay readable. Metric labels are drawn on the first visible line only.

### Text preview

The input text is set with the final polygons from a shared geometry cache, so the canvas, the glyph preview, and the exports always agree.

- Each glyph advances by its advance width plus kerning when the font has it (GPOS `kern` feature or a legacy `kern` table, applied through fontkit's layout). Ligatures are off so every character keeps its own glyph. Fonts without kerning data are labeled as such.
- Line height is ascender − descender + the font's line gap. Spaces advance without drawing. Missing characters are drawn as dashed boxes and listed.
- Up to 1000 characters are shown. Each distinct glyph is processed once per parameter set (cache key: font, glyph, and all geometry parameters).

## Fonts

### Local files

- Formats: `.ttf`, `.otf` (TrueType and CFF outlines), `.woff`, `.woff2`, detected from the file's bytes rather than its extension. Font collections (`.ttc` / `.otc`) are not supported.
- Choose a file from **Import font** or drop it on the canvas. Files are read in the browser and never uploaded. Limit: 50 MB.
- Empty, unrecognized, and damaged files show distinct errors with **Retry**; the previously loaded font stays visible.

### Google Fonts

A CSS preview of a family has no outline data, so the app downloads the actual font file:

1. `GET https://fonts.googleapis.com/css2?family=<Family>:ital,wght@0,100;…;1,900` — the official CSS2 API, no API key. It returns only the styles that exist, one `@font-face` per subset. CORS is allowed.
2. `GET https://fonts.gstatic.com/s/<family>/<version>/<file>.woff2` for the chosen weight, style, and subset.
3. Parse the WOFF2 with fontkit. Only after this succeeds does the font become available.

Limits:

- **Catalog:** the full searchable catalog needs the Google Fonts Developer API key, which cannot be kept secret in a static build. The dialog offers a curated list of 25 families, any family name typed exactly as on fonts.google.com (case-sensitive), or a pasted Google Fonts URL.
- **Subsets:** Google splits families into per-subset files (latin, latin-ext, cyrillic, …). One subset is loaded at a time.
- **Variable fonts:** detected when several weights share one file. Outlines show the default instance; axes are listed but cannot be set (fontkit cannot instantiate variations from WOFF2), so weight selection is disabled.
- **Errors:** unknown families return HTTP 400 without CORS headers, which looks like a network error to the browser. A follow-up `no-cors` request tells "Google rejected the name" apart from "network / CORS / content blocker". Download and parsing errors are reported separately, all with **Retry**.

#### Pasting a Google Fonts URL

The URL is parsed by `src/font/googleUrl.ts` and never fetched itself — only the family and style are read and passed to the flow above.

| URL | What is read |
|---|---|
| `https://fonts.google.com/specimen/Roboto` | Family (`+` = space). Parameters such as `categoryFilters` or `preview.script` are ignored and listed. |
| `https://fonts.googleapis.com/css2?family=Roboto:ital,wght@1,700` | Family, weight, and italic from the first style tuple. A weight range (`wght@300..700`) means the default instance. |
| `https://fonts.googleapis.com/css?family=Lato:300italic` | Legacy API: family and first style (`400`, `700italic`, `300i`, `bold`). |

- Only `https://` URLs on `fonts.google.com` and `fonts.googleapis.com` are accepted. Other hosts, look-alike domains, `http://`, credentials, ports, and other paths are rejected with an explanation.
- With several families or styles, the first is used and the dialog says so. `display`, `subset`, `text`, and tracking parameters are ignored and listed.
- Axes other than `wght` and `ital` (for example `opsz`, `wdth`) cannot be applied; the dialog says so and loads the default instance.
- Missing styles fall back to the default rule (closest to 400), and the dialog names the style that will actually load. For variable families a requested weight cannot be applied, which the dialog also states.

## Geometry pipeline

```text
Original curves (frozen) → Flatten → Squaring → Anchor spacing → Anchor reduction → Grid snapping → Angle lock → Vertex distortion → final polygon
```

The order is fixed (`src/geometry/pipeline.ts`). Every parameter change reruns the whole pipeline from the original curves, so nothing accumulates, and turning a step off restores exactly the result of the steps before it. All distances are in font units and do not depend on canvas zoom. Distortion runs last, so it moves vertices off the snapping grid and off locked angles.

Every step validates each contour: it must keep at least three distinct points, its winding direction (so counters stay holes), non-zero area, and no more self-crossings than before. A contour that fails keeps its previous shape, and the panel names the affected contours and the reason.

### Curve flattening

Every quadratic and cubic segment is replaced by straight edges (`src/geometry/flatten.ts`); the result uses only `M`, `L`, and `Z`.

- **Adaptive (tolerance)** — recursive midpoint subdivision (de Casteljau). A sub-curve becomes one edge once an upper bound on its distance from the chord is within the tolerance (half the control point's distance for a quadratic, ¾ of the larger control distance for a cubic). Range 0.1–100 font units on a logarithmic slider. Safety limits: recursion depth 12 and a 0.01-unit minimum sub-curve length; curves that hit a limit are reported.
- **Fixed segments** — each curve is sampled at `t = i/N` and becomes exactly N edges (1–32). Straight segments stay single edges. A warning appears if an edge strays more than 1 % of the em from its curve.
- **Merge joined curves** (fixed mode, off by default; `src/geometry/curveRuns.ts`) — fonts build one visible curve from several Bézier segments (a Roboto O has 16 per contour), so "N per curve" alone stays smooth even at N = 1–2. Merging joins segments that meet smoothly into one curve and samples it with N edges spaced evenly by arc length.
  - **Break merged curves at:** **Corners & extremes** (default) — corners, straight segments, and the curve's horizontal/vertical extremes (found analytically, even inside a segment), so a round bowl splits into quarter arcs. **Corners only** — a fully smooth loop becomes one curve and uses at least 3 edges.
  - **Corner angle** (1–90°, default 15°): a joint turning more than this always breaks. Merged curves also break at the contour start.
  - Measured on Roboto `a`: 38 segments merge into 12 curves; N = 4 / 3 / 2 / 1 gives 57 / 45 / 33 / 21 vertices (47 without merging at N = 1).
  - If a merged contour fails validation, it uses the unmerged result and the panel reports it. The 1 %-of-em warning is suppressed while merging.

Contours keep their start point, order, and direction; advance widths and side bearings are kept. Glyphs without contours (such as a space) give an empty polygon.

### Squaring

Flattening only approximates curves, so an O stays round. **Squaring** (`src/geometry/squaring.ts`) deliberately reshapes round contours toward their bounding rectangle.

- Each contour is normalized to its own bounding box, and every point moves radially from the box centre toward the box edge. At 100 % it lands on the box, so a circle, ellipse, or superellipse becomes its bounding rectangle with sharp corners. **Amount** (0–100 %, presets Off / Soft / Square) blends linearly.
- A counter uses its own box and becomes a smaller concentric rectangle, so stroke thickness at the side midpoints is unchanged (Roboto O: left stem 191 units, bottom 163 units at 100 %).
- **Applies to: Round contours** (default) squares only contours close to the ellipse that fills their box (edge-weighted mean deviation ≤ 0.06 fully, ≥ 0.16 not at all); stems, triangles, S-curves, and B/D shapes stay as they are. **All contours** pushes every contour toward its box.
- Runs right after flattening, so anchor reduction can then drop the collinear points on the straight sides (a squared O reduces to 4 corners plus its start point).
- At 100 % the O, o, and 0 of Roboto, Inter, and Andale Mono — outer contour and counter — reach an area-to-box ratio of 1.00 (a circle is about 0.79).

### Anchor spacing and reduction

`src/geometry/anchors.ts`. 0 turns either step off; **Reset anchors** turns both off.

- **Anchor spacing** (0–200 font units): every edge, including the closing edge, is split into equal parts no longer than the target. New points lie on the existing edges, so the shape is unchanged. Skipped (with a warning) above 50,000 vertices per glyph.
- **Anchor reduction** (0–100 font units): Ramer–Douglas–Peucker on each closed contour, split at its start point (always kept) and at the vertex farthest from it. Larger values remove more points and can erase small details. Fonts that already contain self-crossing contours keep those crossings but gain none.
- Because spacing points are collinear with their edge, reduction removes them again when both are on; the panel warns about this. Reduction thresholds are absolute font units.

### Grid snapping and angle lock

`src/geometry/constraints.ts`. **Reset grid & angles** restores the defaults (both off, grid 10 u, 45°).

- **Snap to grid** (grid size 0–200 font units; 0 = off): each coordinate becomes `round(v / g) × g`, with the grid anchored at the glyph origin; exact halves round toward +∞. Neighbours landing on the same point are merged. The canvas draws the grid for reference only (not when denser than 4 px).
- **Angle lock** (multiples of 90°, 45°, 30°, or 15°, counter-clockwise from horizontal): each edge turns to the nearest allowed direction (ties go counter-clockwise), then only edge lengths are adjusted — a length-weighted least-squares change that makes the contour close again. The start vertex stays fixed. Contours with no closed solution (for example a triangle at 90°) keep their previous shape.
- Snapping runs first; angle lock then changes edge lengths, so some vertices leave the grid. The panel warns about this.

### Vertex distortion

`src/geometry/distortion.ts`. **Reset distortion** restores the defaults (amplitude 0).

- **Noise amplitude** (0–200 font units): the largest distance a vertex can move; 0 is off.
- **Noise frequency** (0.5–50): noise features per 1000 font units of outline length, sampled by arc length and periodic around each contour, so there is no seam.
- **Normal bias** (0–100 %): 0 % slides vertices along the outline, 100 % pushes them across it.
- **Seed** (0–999,999) and **Next variant** (seed + 1). No `Math.random`, time, or render count is involved; the same glyph, parameters, and seed always give the same shape.
- Edge protection keeps every edge at least half its length and its direction; invalid contours are retried at 50 % and 25 % amplitude, then left undistorted. High frequency on dense outlines can therefore reduce the visible amplitude.

Crossings are checked within each contour, not between contours, so large values in any step can make a counter touch the outer contour.

## Export

Open **Export…** from the header or the tools panel. Nothing is downloaded until you press a download button. Every export uses the same final polygons as the canvas.

### SVG

- **SVG — current glyph** or **SVG — specimen text**. Paths use only `M`, `L`, and `Z` with `fill-rule="nonzero"`; contour order and direction are kept.
- Units are font units. The glyph view box is the advance box from descender to ascender, grown to include any overshoot; the text view box covers every line. Kerning and line breaks match the preview. Missing characters are blank advances, named in an XML comment.
- **Coordinate precision** 0–4 decimal places. If rounding would collapse, flip, or cross a contour, the export stops and asks for a higher precision.
- Text in `<title>` / `<desc>` is XML-escaped; file names use only ASCII letters, digits, `.`, `-`, and `_`.

### Font file

- Format: **OpenType with CFF outlines (`.otf`)**, written with opentype.js (fontkit can only read fonts). Loaded only when you build a font.
- Glyph set: the current glyph, the characters in the text, or all mapped characters (up to 5000 glyphs), plus a `.notdef` box. Every glyph goes through the same pipeline and cache as the canvas.
- Naming: family and style (printable ASCII). The default family adds "Poly"; check the source font's license before sharing a modified font.
- Kept: character mapping, advance widths, contour order and direction, counters, units per em, ascender, and descender. Side bearings follow the final polygon.
- **Build & verify**, then **Download .otf**. The file is reopened with fontkit and compared glyph by glyph (signature, family name, glyph count, every mapping, every advance, every contour point and direction), then loaded through the browser's font engine (`FontFace`, OTS sanitizer). If any check fails, no download is offered. Glyphs that cannot be stored safely are left out and listed.
- Not included: TTF / WOFF / WOFF2 output; kerning, ligatures, and other OpenType layout features; hinting; variation axes (a variable font exports the default instance); glyphs reachable only through layout features; characters above U+FFFF. Coordinates are rounded to whole font units.

## Development

Tech stack: Vite + React + TypeScript, with [fontkit](https://github.com/foliojs/fontkit) for reading fonts and [opentype.js](https://github.com/opentypejs/opentype.js) for writing them (both loaded on demand).

```text
src/
├── main.tsx, App.tsx      Entry point; App owns state (useReducer) and assembles the layout
├── components/            UI: ToolHead (ImportMenu, FontStatus) + GeometryPanel (top left),
│                          CanvasViewport / SpecimenView (top right), GlyphPanel / GlyphPicker (bottom left),
│                          InputPanel = TextPanel + GlyphPreview / GlyphView (bottom right); shared GlyphLayers, usePanZoom
├── font/                  Loading and parsing: local files, Google Fonts, Google Fonts URL parsing,
│                          format sniffing, fontkit adapter, shaping, glyph search
├── state/                 Document and parameter state, reducer, imports (useFontImport),
│                          derived geometry (useDerivedGeometry) and text layout (useSpecimenScene)
├── geometry/              Pure TypeScript geometry core (no React / DOM): flatten, curveRuns, squaring,
│                          anchors, constraints, distortion, pipeline, shared cache, SVG path helpers
├── specimen/              Text layout with final polygons, advances, and kerning (preview and export)
├── export/                SVG serialization, precision checks, OpenType writing and read-back verification
└── styles.css
```

- State has three layers: document state and parameter state in `src/state/`, and derived geometry computed with `useMemo` (never stored in the reducer). Parameters are deferred with `useDeferredValue` so slider drags stay responsive. React components only render state and dispatch actions; geometry stays in `src/geometry/`.
- Conventions, such as an English-only UI and separate English / Chinese documents, are in [docs/BEST_PRACTICE.md](docs/BEST_PRACTICE.md).

## Deploy to GitHub Pages

- **Release branch:** `main`. `.github/workflows/deploy.yml` runs only on pushes to `main` (or a manual run on `main`); `develop` and `feature/*` never deploy.
- **Base path:** production builds use `/None-Curve/` (`pagesBase` in `vite.config.ts`). Update it if the repository is renamed. Files in a `public/` folder must be referenced through `import.meta.env.BASE_URL`.

1. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Merge into `main` and push (or run **Deploy to GitHub Pages** from the **Actions** tab with `main` selected). The workflow runs `npm ci`, `npm run build`, and publishes `dist/`.
3. The site is served at `https://<owner>.github.io/<repo>/`, i.e. `https://m1ingx1xx1.github.io/None-Curve/`.

## Roadmap: Sound → Carving Logic → Letterform

Planned, **not implemented yet**: map volume, pitch, rhythm, duration, frequency distribution, and texture to depth, pressure, stroke width, edge roughness, erosion, and chisel angle, then generate reproducible polygon letterforms. See the [product requirements](docs/PRD.md) and the [implementation plan](docs/PHASE.md).
