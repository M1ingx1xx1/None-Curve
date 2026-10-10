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
| Random anchors on the original curves with a reproducible seed | 🧪 Experimental |
| Live text preview with advance widths, kerning, multiple lines, and missing-character marks | ✅ Implemented |
| Canvas (artboard) with size, aspect presets, and 1×–4× export multiplier; typography (size, tracking, line height, slant, alignment, letter case); colour presets and custom colours | ✅ Implemented |
| SVG and PNG export of the canvas, optionally with the preview's blur and inverted colours | ✅ Implemented |
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
┌────────────────────────╥───────────────────────────────────────────────────┐
│ Tools                  ║ Result canvas                                     │
│ Import · font info     ║ shows only the input text                         │
│ Geometry (scroll)      ║                                                   │
╞════════════════════════╩═════╦═════════════════════╦═══════════════════════╡
│ Typography / Glyphs / Color  ║ Text input          ║ Preview + Blur/Invert │
└──────────────────────────────╨─────────────────────╨───────────────────────┘
```

Double lines are drag handles. Each one only moves the border between its two neighbours, so they always add up to the same size: the top and bottom rows always fill the window between the header and the status bar (no page scrolling), the tools and the canvas share the top row's width, and in the bottom row the Typography / Glyphs / Color tabs, the text input, and the preview always add up to the row's width (minimum widths 260, 180, and 200 px). Every handle is the 1 px divider itself (in the quiet border colour, like the header and status bar edges), with an invisible 9 px grab area. Drag a handle, or focus it and use the arrow keys (Home / End jump to the limits); double-click resets it. Every area keeps a minimum size, and the splits are remembered in the browser. The top and bottom rows are split independently, so their column borders need not line up.

- **Top left — tools:** **Import font** and the font information come first, then the **Geometry** panel: every geometry parameter (flattening, squaring, anchors, grid & angles, distortion) in pipeline order, then the experimental Random anchors. Parameter statistics refer to the selected glyph. Controls that currently have no effect are greyed out: all of Curve flattening while Random anchors are on, and the random seed at 0 % randomness. Explanations are folded behind an ⓘ button next to each label (click or tap to open, so it also works on touch screens and with the keyboard; the text stays the control's screen-reader description while folded); **Show all explanations** at the top of the Geometry panel opens them all (the Typography and Color tabs included) and is remembered in the browser. Warnings, statistics, and notes about why a control is disabled are always shown.
- **Top right — result canvas:** shows the canvas (artboard) with the text from the input, set with the current font, all parameters, the Typography settings, and the colours. Below it, **Canvas size** opens and closes a drawer with the canvas size (see [Canvas size](#canvas-size)); the drawer's state is remembered. Its outline and layer controls (Original / Flattened / Compare, Fill, Skeleton, Vertices, Metrics) also drive the preview; zoom and pan apply to the canvas only. Each glyph's click target is its box (advance width by ascender to descender), so small text is easy to hit. Clicking a glyph selects it (the statistics follow it) and recolours every copy of it (hovering does the same) with a highlight colour computed from the text and background colours: among colours that stay readable on the background (at least the text's own contrast, up to 4.5 : 1, and never below 3 : 1), the one that differs most from the text colour in hue and chroma (OKLab), preferring vivid colours, penalising lightness that fades toward the background, and staying within 40° of the palette's hue (90° when a text that is already vivid leaves too little room; the text's hue, otherwise the background's, otherwise orange). Black on cream paper highlights in vermilion; a coloured text gets a vivid neighbouring hue. Clicking empty canvas (not the end of a drag) or pressing Escape clears the highlight; the statistics keep showing the last selected glyph, which the **Statistics** line at the top of the Geometry panel names (character and code point). The preview never shows the highlight.
- **Bottom left — text tools:** three tabs (remembered in the browser; arrow keys move between them; all stay loaded, so switching keeps local state): **Typography** — how the text is set on the canvas (see [Typography](#typography)); **Glyphs** — see below; **Color** — the text and background colours.
- **Glyphs tab:** a searchable grid of every character the font maps, used as an inserter: clicking a character inserts it into the text at the cursor (replacing selected text) and selects that glyph. Before the text box has been focused, characters are appended. Glyphs without a character (ligatures, alternates) and control characters are not listed, since they cannot be typed. When the glyph list is narrower than 280 px, the cells shrink and show only the character; the code point labels return above that width (the code point stays in each cell's tooltip).
- **Bottom right — input and preview:** a compact multi-line text input (letter case toggles **AA** / **Aa** / **aa** right of the Text title, sample texts in a menu, Clear, character count, kerning status, missing characters); then a miniature of the canvas exactly as it is exported (cut to the canvas edges) with its own **Blur** slider (0–12 px) and an **Invert** button that swaps the text and background colours. Blur and Invert only affect this view unless **Export the preview look** is ticked — a squint test for the overall shape. A handle between the two parts moves the border (default 40 / 60).
- **Status bar:** the font status, the selected glyph, and the current view; at its right end, a small light / dark switch for the interface. Every visit starts with the system setting (`prefers-color-scheme`) and follows it when it changes; a choice there lasts for the visit and is not stored. The theme tokens are CSS `light-dark()` values, switched by `color-scheme` on `<html data-theme>`. The canvas keeps the Color settings in both themes.
- Narrow screens stack (no handles): import and font info, the canvas (at least 62 % of the viewport height), parameters (collapsed; **Parameters** in the canvas toolbar opens them), text input, preview, then the Typography / Glyphs / Color tabs.

### Canvas

- Outline view: **Original** (font curves), **Flattened** (final polygon), **Compare** (final polygon with the original curves overlaid as a dashed line). The current view is shown in the canvas corner and the status bar.
- Layers: **Fill** (off = outline stroke), **Skeleton** (original on-curve anchors as squares, off-curve controls as hollow circles, and handles; TrueType's implied on-curve points appear as anchors), **Vertices** (final polygon vertices as green dots), and **Metrics** (ascender, cap height, x-height, baseline, descender, advance width).
- Zoom with the mouse wheel or `+` / `−`, pan by dragging or with the arrow keys (canvas focused), `0` or **Fit** to reset. The preview (bottom right) is always fitted and is not interactive.
- All layers apply to every glyph of the text. Only glyphs inside the visible area are drawn. Skeleton points and vertices appear once an em is at least 48 px on screen; below that the canvas asks you to zoom in, so long texts stay readable. Metric labels are drawn on the first visible line only.

### Canvas size

The text is set on a canvas (artboard) of a fixed pixel size; zoom 1 fits the whole canvas. The background colour fills the whole view. Outside the artboard (the pasteboard) it is 7 % darker (6 % lighter on a dark background) and carries a screen grid (every 24 px) in black on light backgrounds and white on dark ones, at the opacity that gives a contrast of 1.3 : 1 with the background — the same visibility in every palette, whatever the text colour (`gridLineColor` in `src/specimen/color.ts`; the snap grid of Grid & angles uses 1.5 : 1); inside, the artboard looks exactly like the export. The grid fades in inside the artboard only while it helps: while dragging the text (Free position) or at 200 % zoom and above. A soft shadow lifts the artboard off the pasteboard — dark on light backgrounds, a light glow on dark ones; its 1.5 px outline (interface mint, never the text colour) is currently transparent (`.pasteboard`, `.artboard-grid`, and `.artboard-frame` in `src/styles.css`); the metric guides are drawn in the text colour too. A transparent background shows as a checkerboard of the background colour and the same tinted with the text colour, so the text stays readable. The drawer below the canvas holds:

- **W** / **H**: canvas width and height, 100–4000 px (slider or number box; the box commits on Enter or when you leave it, clamped to the range).
- Aspect presets **1:1**, **4:3**, **16:9**, **4:5**, **3:2**, **3:4** keep the width and set the height (or keep the height if that would exceed the range); the matching preset is highlighted. **Swap** exchanges width and height.
- **1×–4×**: export multiplier. A PNG is width × multiplier by height × multiplier pixels with the same layout, so higher multipliers are sharper.

Text that runs past the canvas edge stays visible on the canvas with a warning; the preview and the exports are cut to the canvas.

### Typography

`src/specimen/artboard.ts` and `src/specimen/scene.ts`. These settings change the layout and the SVG/PNG export, not the glyph geometry or the font file.

- **Size** (4–1000 px, default 48): the em in canvas pixels; changing the canvas size does not change it. **Fit text** sets the largest whole-pixel size at which the outlines, slant included, fit inside the margin on both axes.
- **Margin**: the position anchors and Fit text keep 25 canvas pixels between the outlines and every canvas edge, whatever the font size (`EDGE_MARGIN_PX` in `src/specimen/artboard.ts`). There is no control for it.
- **Tracking** (−200–1000 thousandths of an em): added between glyphs on top of advances and kerning, not after a line's last glyph.
- **Line height** (0.5–3 ×): multiple of the font's line spacing (ascender − descender + line gap).
- **Slant** (−30°–30°): a skew around each glyph's own baseline (x′ = x + tan(slant) · y); positive leans right.
- **Align** Left / Center / Right (icon buttons): aligns the lines with each other inside the block.
- **Position**: where the block sits on the canvas. Nine anchors (a 3 × 3 grid: corners, edge middles, centre) place the outlines' box (slant included; not the line box, so side bearings and ascender space do not leave a gap) against the left margin, centred, or against the right margin, and against the top margin, centred, or against the bottom margin — the letters sit 25 px from the edges and corners. An anchor also sets **Align** to its column (left column left, middle column centre, right column right); Align can still be changed afterwards. The default is left, vertically centred. The chosen anchor (and Free when on) glows in the primary mint. **Free** lets you drag the text on the canvas (drags that start elsewhere still pan); the position is stored as a share of the room the canvas leaves beside and above the outlines' box, so the text stops at the canvas edges and stays inside when its size or the canvas changes. Pressing Free puts the text back at the default position and alignment (left, vertically centred) and then lets you drag it; pressing it again resets it there.
- **Letter case** (**AA** / **Aa** / **aa**, right of the Text title): **All caps**, **Title case** (first letter of every word upper case, the rest lower case), or **Lower**; press the active one again for the text as typed. The typed text is never changed; the canvas, the preview, the exports, and the font file's "Specimen characters" use the converted text.
- **Reset typography** restores the defaults (4 %, 0, 1, 0°, left-aligned, positioned left and vertically centred) and keeps the letter case.

### Color

Twelve presets (Charcoal — the default, dark text on paper — Off White, Kryptonite, Plum, Glowing Cyan, Acid Lime, Ember, Moonlit Purple, Chrome Pink, Cherry, Atomic Blue, Forest Moss), **Random** (a random readable pair, contrast ≥ 4.5 : 1), **Swap**, and custom **Text** and **Background** colours with a colour picker and a hex box (`#rgb` or `#rrggbb`). The contrast ratio is shown, with a warning below 3 : 1. **Transparent background** leaves the background out of SVG and PNG exports; the background colour is kept for Swap, Invert, and the checkerboard. Hover and selection on the canvas use a highlight colour computed from the text and background colours (see the result canvas above).

### Text preview

The input text is set with the final polygons from a shared geometry cache, so the canvas, the preview, and the exports always agree.

- Each glyph advances by its advance width plus kerning when the font has it (GPOS `kern` feature or a legacy `kern` table, applied through fontkit's layout). Ligatures are off so every character keeps its own glyph. Fonts without kerning data are labeled as such.
- Line height is ascender − descender + the font's line gap, times **Line height**. Spaces advance without drawing. Missing characters are drawn as dashed boxes and listed.
- Up to 1000 characters are shown. Each distinct glyph is processed once per parameter set (cache key: font, glyph, and all geometry parameters).

### Performance

- **Geometry worker** (`src/geometry/geometry.worker.ts`, `src/state/geometryClient.ts`): the pipeline runs in a Web Worker that opens its own copy of the font, so the page never waits on it. The selected glyph is computed first (its statistics), then the text's glyphs in reading order; results come back in batches every ~40 ms and are shown together (one re-render per 50 ms). A newer parameter set stops the older one between glyphs. Until a glyph's new shape arrives the canvas keeps its previous one, and the canvas badge shows "Updating N…". Results for the last four parameter sets are kept, so stepping back is instant. Without worker support, or if the worker cannot open the font, glyphs are computed on the page as before. Export uses the worker's results and computes only what is missing.
- **Text layout** is split into shaping (`shapeSpecimen`, rerun only for text or typography changes) and placing polygons (`placePolygons`, rerun as results arrive). Path strings and slanted extents are cached per polygon, and each glyph on the canvas is a memoised component, so a text that repeats a letter builds its outline once and unchanged glyphs are not drawn again.
- **Free position drag** moves the text with an SVG transform only; the position is committed once, on release, so dragging never re-renders the page.
- **Crossing checks** (`src/geometry/crossings.ts`), run by every step for every contour and retry, sweep segments sorted by x and compare only pairs whose boxes overlap, stop as soon as the count exceeds the original's, and count each contour's own crossings once. A 15 000-point contour (Anchor spacing 1) is checked in milliseconds instead of seconds. Checks between two contours (`src/geometry/contourLayout.ts`) first compare bounding boxes and only look at segments inside the overlap; each pair's original arrangement is worked out once per step.
- **Geometry cache**: least recently used entries are dropped beyond 4000 glyphs or 1 000 000 polygon points per font, so dense settings cannot fill memory.
- Measured (production build, 1000 characters, Inter): each Tolerance slider step costs ~10 ms of page time (was ~90 ms), Random anchors at density 100 ~9 ms (was 260–690 ms); spacing 1 + grid 50 + 15° + distortion takes 48 ms for "@" (was 2.8 s); computing and rounding all 2691 Arial glyphs at spacing 1 takes 3 s with ~200 MB live memory.

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

- **Catalog:** the full searchable catalog needs the Google Fonts Developer API key, which cannot be kept secret in a static build. The dialog offers a curated list of 15 families — Sans: Google Sans, Noto Sans, Archivo, Inter, DM Sans; Serif: EB Garamond, Baskervville, Bodoni Moda, DM Serif Display; Slab: Slabo 13px, Arvo; Mono: IBM Plex Mono, JetBrains Mono, Space Mono, DM Mono — any family name typed exactly as on fonts.google.com (case-sensitive), or a pasted Google Fonts URL.
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
Original curves (frozen) → Flatten (or experimental Random anchors) → Squaring → Anchor spacing → Anchor reduction → Grid snapping → Angle lock → Vertex distortion → final polygon
```

The order is fixed (`src/geometry/pipeline.ts`). Every parameter change reruns the whole pipeline from the original curves, so nothing accumulates, and turning a step off restores exactly the result of the steps before it. All distances are in font units and do not depend on canvas zoom. Distortion runs last, so it moves vertices off the snapping grid and off locked angles.

Every step validates each contour: it must keep at least three distinct points, its winding direction (so counters stay holes), non-zero area, and no more self-crossings than before. It must also sit against the glyph's other contours as before (`src/geometry/contourLayout.ts`): contours that were apart stay apart, a counter stays inside its outer contour, and nothing moves into another contour. Without this, a counter pushed out of its letter is filled as a solid shape beside it. Steps change contours one at a time and check each new contour against the others as they are at that moment, so the finished glyph is valid as a whole. Flattening itself is checked against a much finer flattening of the original curves (see below).

Before giving up, steps degrade gracefully: squaring uses the largest safe share of the amount (backed off slightly from the limit so later steps still have room), grid snapping and angle lock retry on progressively simplified copies of the contour and, for angle lock, finally as stair steps (each off-angle edge split into two allowed directions, no vertex moved), and distortion lowers the amplitude where the contour crosses, then overall. Only a contour for which every attempt fails keeps its previous shape; the panel reports reduced, simplified, and unchanged contours, and why.

Measured on the Latin glyphs of Arial, New York, and Georgia, the share of glyphs whose contours crossed each other or left one another went from 13–25 % to 0 with Angle lock 90°, 16–18 % to 0 with Random anchors at density 1, 25–31 % to 0 with Grid 200, 4–18 % to 0 with Distortion 200, and 0–5 % to 0 with Merge joined curves at 1 segment. Across 6480 random parameter combinations on four fonts, no glyph has a new crossing, within a contour or between two.

### Curve flattening

Every quadratic and cubic segment is replaced by straight edges (`src/geometry/flatten.ts`); the result uses only `M`, `L`, and `Z`.

- **Adaptive (tolerance)** — recursive midpoint subdivision (de Casteljau). A sub-curve becomes one edge once an upper bound on its distance from the chord is within the tolerance (half the control point's distance for a quadratic, ¾ of the larger control distance for a cubic). Range 0.1–500 font units on a logarithmic slider. Without merging every font curve keeps at least one edge, so raising the tolerance beyond about 100 changes little (Roboto: 11,219 vertices at both 100 and 500 over the first 400 glyphs); turn on **Merge joined curves** for coarser shapes. Safety limits: recursion depth 12 and a 0.01-unit minimum sub-curve length; curves that hit a limit are reported.
- **Fixed segments** — each curve is sampled at `t = i/N` and becomes exactly N edges (1–32). Straight segments stay single edges. A warning appears if an edge strays more than 1 % of the em from its curve.
- **Merge joined curves** (both modes, off by default; the merge settings are shared; `src/geometry/curveRuns.ts`) — fonts build one visible curve from several Bézier segments (a Roboto O has 16 per contour), so per-curve settings alone stay smooth. Merging joins segments that meet smoothly into one curve. In fixed mode it is sampled with N edges spaced evenly by arc length; in adaptive mode it is simplified as a whole (Ramer–Douglas–Peucker on dense samples of the curve) so that no sample is farther than the tolerance from its edge, with at least 3 edges for a closed loop. Vertices stay on the curve. Roboto, first 400 glyphs, adaptive: 6,365 vertices at tolerance 500 with merging, against 11,219 without; the `o` goes from 36 to 12 vertices (Inter: 24 to 8).
  - **Break merged curves at:** **Corners & extremes** (default) — corners, straight segments, and the curve's horizontal/vertical extremes (found analytically, even inside a segment), so a round bowl splits into quarter arcs. **Corners only** — a fully smooth loop becomes one curve and uses at least 3 edges.
  - **Merge through straight lines** (off by default): straight segments that meet a neighbour smoothly also join the merged curve, so stems that flow into arches (n, m, u) or the straight sides of some O shapes are resampled with the curve. With this on, the extremes rule applies only between curves (a stem meets an arch exactly at its extreme). A straight segment left alone stays a line. Letters change a lot — stems can lose their ends.
  - **Corner angle** (1–90°, default 15°): a joint turning more than this always breaks. Merged curves also break at the contour start. Without merging through lines it only affects curve-to-curve joints, which in most fonts are already smooth (in Roboto 6200 of 6206 turn less than 1°), so it rarely changes anything. With merging through lines it decides which line joints merge: going from 15° to 90° changes 365 of the first 400 Roboto glyphs.
  - Measured on Roboto `a`: 38 segments merge into 12 curves; N = 4 / 3 / 2 / 1 gives 57 / 45 / 33 / 21 vertices (47 without merging at N = 1).
  - If a merged contour fails validation, it uses the unmerged result and the panel reports it. The 1 %-of-em warning is suppressed while merging.

- **Validation.** The result is compared with a much finer flattening that stands in for the original curves (tolerance 1/5000 em). Where an edge cuts across a stroke thinner than the tolerance, so the outline crosses itself or another contour where the original does not, only the curves involved are flattened again, each round with a quarter of the tolerance (adaptive) or twice the edges (fixed), up to 6 rounds; the panel counts the curves flattened more finely. New York's U, Ù, Ú, Û, Ü and its 6 and 9 crossed themselves at the default settings; they no longer do.
- Contours with no area (fewer than three points, or all points on a line) are left out and reported.

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

- **Snap to grid** (grid size 0–200 font units; 0 = off): each coordinate becomes `round(v / g) × g`, with the grid anchored at the glyph origin; exact halves round toward the centre of the glyph's bounding box, so a symmetric letter stays symmetric. Neighbours landing on the same point are merged. The canvas draws the grid for reference only (not when denser than 4 px).
- **Angle lock** (multiples of 90°, 45°, 30°, or 15°, counter-clockwise from horizontal): each edge turns to the nearest allowed direction (ties go counter-clockwise), then only edge lengths are adjusted — a length-weighted least-squares change that makes the contour close again. Each edge keeps only the part of its length along its new direction, so locking shrinks curves (at 90° an O loses about 30 % of its width and height); the result is therefore fitted to the original's bounding box instead of pinning the start vertex: at 90° width and height are scaled separately (every edge is horizontal or vertical, so angles are kept), otherwise one scale keeps the box's area, the contour is centred sideways and keeps its bottom, so letters stay on the baseline. Locking is rejected when it changes the shape too much — a vertex moves more than 20 % of the contour's bounding-box diagonal, or the area changes by more than 30 % (an S whose openings close up) — and retries simplify the contour by at most 4 % of that diagonal. A glyph is locked or stepped as a whole: if any contour is rejected, or locking every contour on its own would pull the glyph apart (Roboto builds a V from two overlapping legs; locked separately they become two bars), every contour gets stair steps. Stairs keep every vertex; off-angle edges longer than 1/40 em are first split, so a long diagonal becomes a fine staircase that follows it; corners go away from the ink (outward on outer contours, into counters); and where two neighbouring steps would cross at a sharp inner turn, one is flipped. Only if those cross too does a contour keep its previous shape. Before, Arial's Z at 90° slid about 800 units left onto the previous letter and its X dropped 512 units below the baseline; both now keep their bounding box. On printable ASCII, the largest vertex move at 90° went from 1024 to 290 units in Arial, and contours left unlocked went from 15 to 0 (Arial 90°), 8 to 0 (Arial 45°), 2 to 0 (Arial 30°), and 24 to 20 (New York 90°, whose hairlines are only a few units thick); New York went from 8 to 11 at 45° and 4 to 5 at 30°, because overlaps that used to pass are now caught. "Largest move" measures each original vertex's distance to the new outline.
- Snapping runs first; angle lock then changes edge lengths, so some vertices leave the grid. The panel warns about this.

### Vertex distortion

`src/geometry/distortion.ts`. **Reset distortion** restores the defaults (amplitude 0) but keeps the current seed.

- **Noise amplitude** (0–200 font units): the largest distance a vertex can move; 0 is off.
- **Noise frequency** (0.5–50): noise features per 1000 font units of outline length, sampled by arc length and periodic around each contour, so there is no seam.
- **Normal bias** (0–100 %): 0 % slides vertices along the outline, 100 % pushes them across it.
- **Seed** (0–999,999) and **Next variant** (seed + 1). No `Math.random`, time, or render count is involved; the same glyph, parameters, and seed always give the same shape.
- Edge protection limits only how far the two ends of an edge may move toward each other along it (at most half its length), so no edge collapses or reverses; movement across the outline is not limited. Along-the-outline movement is shortened first, movement across it only where that is not enough (the inside of a tight curve). Limiting all relative movement, as before, made the distortion weaker the denser the outline, because neighbouring vertices of a dense outline are close together.
- Where a distorted contour crosses itself or another contour (dense outlines at inner corners, thin strokes, counters near their outer contour), the amplitude is halved around the crossing, fading out over one amplitude of outline on each side, up to 12 times; the rest of the contour keeps the full amplitude. If that is not enough, the whole contour is retried at 1/2 down to 1/16 of the amplitude, then left undistorted.
- Measured on 32 Arial letters and digits, the median vertex movement at amplitude 40 is now 18 / 18 / 16 units with Anchor spacing off / 10 / 1 (before: 18 / 6.5 / 0), and at amplitude 200 it is 67 / 46 / 25 (before: 22 / 0.3 / 0).

### Random anchors (experimental)

`src/geometry/randomAnchors.ts`. The last group in the tools panel, off by default. When on, anchors are placed at random arc-length positions on the **original curves** instead of Flatten's regular sampling; each anchor is evaluated on the source Bézier, so it lies exactly on the glyph outline. The result then goes through Squaring, Anchors, Grid, and Distortion as usual. Because Flatten's polygon is replaced, the whole Curve flattening group is greyed out while this is on (its settings would only shape contours that fall back).

- **Density** (1–100): about how many anchors per 1000 font units of outline; every contour keeps at least 3.
- **Randomness** (0–100 %): stratified sampling. Each anchor has its own stretch of outline; 0 % puts it in the middle, 100 % anywhere inside it. Anchors never change order, so the outline cannot fold back.
- **Keep sharp corners** (on by default): source joints that turn by more than 30° stay as fixed anchors, and each stretch between two corners is sampled on its own.
- **Seed** (0–999,999; greyed out at 0 % randomness, where it has no effect): **Shuffle** picks a new seed (only the button uses the browser's random generator); **Copy** copies it; **Previous** lists the last six seeds of this session so you can go back. The seed also appears in the status bar and the export dialog.
- Reproducible: the random numbers come from a hash of (seed, the contour's outline, attempt), so the same font, settings, and seed always give the same polygon. Repeated letters in the text look identical, and so do different glyphs that share an outline (Latin A and Greek Alpha); different outlines get different draws.
- Validation: a draw that reverses a contour, collapses it, adds self-crossings, or crosses or leaves another contour is redrawn with a derived seed (up to 4 draws, still deterministic); if none is valid, that contour uses Flatten's result and the panel says so.
- **Reset random anchors** restores the defaults but keeps the current seed.

## Export

Open **Export…** from the top-right corner of the header. Nothing is downloaded until you press a download button. Every export uses the same final polygons as the canvas.

### SVG and PNG

- **SVG — main view** (default) and **PNG — main view** export the canvas: its size, the text placed by the Typography settings, and the Color settings. With **Transparent background** on (Color tab) the background is left out, for SVG and for PNG with transparency; this applies to the preview look too. The SVG is width × height px; the PNG is that times the **Canvas size** multiplier, rendered from the same SVG.
- **Export the preview look** (checkbox, off by default) exports the bottom-right preview instead: its colours (swapped when **Invert** is on) on a solid background, with its **Blur**. The blur is converted from preview pixels to font units and then to canvas pixels, so it keeps its size relative to the letters at any resolution; in SVG it is an `feGaussianBlur` filter on an untransformed group.
- Each glyph is one path in its own font units (y up, so outline coordinates keep full precision), placed with `translate(…) skewX(…) scale(1 −1)` inside a group that scales font units to canvas pixels. Paths use only `M`, `L`, and `Z` with `fill-rule="nonzero"`; contour order and direction are kept. Kerning, tracking, and line breaks match the canvas. Missing characters are blank advances, named in an XML comment.
- **Coordinate precision** 0–4 decimal places. Rounding is checked and repaired as for the font file (below); if a contour would still collapse, flip, or cross itself, the export stops and asks for a higher precision.
- Text in `<title>` / `<desc>` is XML-escaped; file names use only ASCII letters, digits, `.`, `-`, and `_`.

### Font file

- Format: **OpenType with CFF outlines (`.otf`)**, written with opentype.js (fontkit can only read fonts). Loaded only when you build a font.
- Glyph set: the current glyph, the characters in the text, or all mapped characters (up to 5000 glyphs and 1,000,000 outline points — very dense settings such as Anchor spacing 1 reach the point limit with a whole font, and the build stops with a message), plus a `.notdef` box. Every glyph goes through the same pipeline and cache as the canvas.
- Naming: family and style (printable ASCII). The default family adds "Poly" (and drops a leading ".", which hides a font from menus). The PostScript name is `Family-Style` without spaces or reserved characters, at most 63 characters; the unique ID is `1.000;None-Curve;<PostScript name>`. If the source's SIL OFL copyright or license reserves a font name ("Reserved Font Name") and the family name contains it, the dialog warns that a modified version must be renamed.
- Kept: character mapping, advance widths, contour order, counters, units per em, ascender, and descender. Side bearings follow the final polygon. Contours are written in the CFF direction (outer contours counter-clockwise; a glyph whose largest contour runs clockwise, as in TrueType sources, is reversed as a whole).
- Copied from the source: OS/2 weight and width class, style bits (`fsSelection`, kept consistent with head `macStyle`), embedding permissions (`fsType`), panose, family class, sub- and superscript and strikeout metrics, typo ascender / descender / line gap, x-height and cap height; the hhea line gap; the post italic angle, underline position and thickness, and fixed pitch. The Windows ascent and descent are the source's, raised if the new outlines reach further (Windows clips outside them). Name records copied: copyright, trademark, manufacturer, designer, vendor and designer URLs, license, and license URL; the description says the outlines were rebuilt with None-Curve. Entries the source lacks are left out instead of written as blanks. The CFF FontBBox is the real bounding box. Fields the writer (opentype.js) cannot set — hhea line gap, head `macStyle`, CFF FontBBox — are patched into the finished file (`src/export/sfnt.ts`), which is then re-checksummed.
- Rounding (`src/export/quantize.ts`): each contour is rounded to whole units, then repeated points, zero-length edges, and points on a straight line between their neighbours (including back-and-forth spikes) are removed. It must keep at least three points, its direction, and non-zero area, and gain no new self-crossings. A crossing counts as new only where the unrounded contour neither crossed itself nor ran within two units of itself — outlines that already overlap (common in fonts), or whose parts nearly touch, cannot avoid that at whole units, and the difference is below one unit. Rounding crossings are first repaired by removing one of the vertices involved; failing that, the contour is simplified very slightly (0.5–2 units) and rounded again. A collapsed contour smaller than 4 square units is left out on its own. Each rounded contour must also sit against the glyph's other contours as before; a new crossing between two contours is accepted only where both already ran within two units of each other, and a repair that would push a contour into another is passed over for the next attempt. Crossing checks sweep segments sorted by x, so contours with thousands of points (Anchor spacing 1) stay fast. Measured on New York and Arial, no glyph is left out at the default settings, with Squaring at Square / All contours, with Anchor spacing 1, or with Distortion 40 (before: 42 New York glyphs at the defaults, including every "a", and 26 % with Square / All).
- **Build & verify**, then **Download .otf**. The file is reopened with fontkit and compared glyph by glyph (signature, family name, glyph count, every mapping, every advance, every contour point and direction), then loaded through the browser's font engine (`FontFace`, OTS sanitizer). If any check fails, no download is offered. Glyphs that cannot be stored safely are left out and listed, with a note that a font stores whole font units (no precision setting applies).
- Not included: TTF / WOFF / WOFF2 output; kerning, ligatures, and other OpenType layout features; hinting; variation axes (a variable font exports the default instance); glyphs reachable only through layout features; characters above U+FFFF. Coordinates are rounded to whole font units.

## Development

Tech stack: Vite + React + TypeScript, with [fontkit](https://github.com/foliojs/fontkit) for reading fonts and [opentype.js](https://github.com/opentypejs/opentype.js) for writing them (both loaded on demand).

```text
src/
├── main.tsx, App.tsx      Entry point; App owns state (useReducer) and assembles the layout
├── components/            UI: ToolHead (ImportMenu, FontStatus) + GeometryPanel (top left),
│                          CanvasViewport / SpecimenView (top right), TextTools = TypographyControls +
│                          GlyphPanel / GlyphPicker + ColorControls (bottom left), InputPanel = TextPanel +
│                          TextPreview (bottom right), StatusBar + ThemeToggle; shared GlyphLayers, Icon,
│                          usePanZoom, useSplit
├── font/                  Loading and parsing: local files, Google Fonts, Google Fonts URL parsing,
│                          format sniffing, fontkit adapter, shaping, glyph search
├── state/                 Document and parameter state, reducer, imports (useFontImport),
│                          geometry worker client (geometryClient), derived geometry (useDerivedGeometry)
├── geometry/              Pure TypeScript geometry core (no React / DOM): flatten, curveRuns, squaring,
│                          anchors, constraints, distortion, pipeline, crossing and contour-layout
│                          checks, shared cache, worker, SVG path helpers
├── specimen/              Text layout with final polygons, advances, and kerning (preview and export)
├── export/                SVG serialization, precision checks, OpenType writing, patching (sfnt.ts), and read-back verification
└── styles.css
```

- State has three layers: document state and parameter state in `src/state/`, and derived geometry (never stored in the reducer) computed in the geometry worker and assembled by `useGeometry` (`src/state/useDerivedGeometry.ts`). Text and typography are deferred with `useDeferredValue` so typing stays responsive. React components only render state and dispatch actions; geometry stays in `src/geometry/`.
- Conventions, such as an English-only UI and separate English / Chinese documents, are in [docs/BEST_PRACTICE.md](docs/BEST_PRACTICE.md).

## Deploy to GitHub Pages

- **Release branch:** `main`. `.github/workflows/deploy.yml` runs only on pushes to `main` (or a manual run on `main`); `develop` and `feature/*` never deploy.
- **Base path:** production builds use `/None-Curve/` (`pagesBase` in `vite.config.ts`). Update it if the repository is renamed. Files in a `public/` folder must be referenced through `import.meta.env.BASE_URL`.

1. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Merge into `main` and push (or run **Deploy to GitHub Pages** from the **Actions** tab with `main` selected). The workflow runs `npm ci`, `npm run build`, and publishes `dist/`.
3. The site is served at `https://<owner>.github.io/<repo>/`, i.e. `https://m1ingx1xx1.github.io/None-Curve/`.

## Roadmap: Sound → Carving Logic → Letterform

Planned, **not implemented yet**: map volume, pitch, rhythm, duration, frequency distribution, and texture to depth, pressure, stroke width, edge roughness, erosion, and chisel angle, then generate reproducible polygon letterforms. See the [product requirements](docs/PRD.md) and the [implementation plan](docs/PHASE.md).
