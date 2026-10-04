# None-Curve

An experimental web app for turning font curves into editable polygon shapes. Load a font to see its glyphs rendered live, then adjust the controls on the left and watch the outlines update on the canvas. Set specimen text with the polygon outlines, and export a glyph or the specimen as SVG, or the glyph set as an OpenType font, when you’re ready. An audio-driven carving tool is planned as a later, optional module.

## 中文

一个将字体曲线转换成可编辑多边形的实验性网页工具。载入字体后即可看到字形的实时预览，在左侧调整控制项，画布中的轮廓会随之更新；可以输入样张文本检查效果，并在准备好后手动导出字形 / 样张 SVG 或 OpenType 字体文件。声音驱动石刻是后续阶段的可选模块，尚未实现。

### 功能状态 / Feature status

| 功能 Feature | 状态 Status |
|---|---|
| 本地字体导入（.ttf / .otf / .woff / .woff2）、Google Fonts 导入 | ✅ 已实现 Implemented |
| 字形选择、原始曲线骨架、Original / Flattened / Compare 视图 | ✅ 已实现 |
| 曲线展平、方形化（圆形 O → 方形 O）、锚点间距 / 简化、网格吸附、角度锁定、确定性顶点扰动 | ✅ 已实现 |
| Google Fonts URL 粘贴导入（specimen 页面、CSS2 / CSS API 链接） | ✅ 已实现 |
| 田字形布局：左上功能区（导入、字体信息、参数）、右上结果画布 C、左下文本 B、右下字形预览 A | ✅ 已实现 |
| 样张文本预览（字宽、字偶距、多行、缺字提示） Specimen | ✅ 已实现 |
| SVG 导出：当前字形、样张文本 | ✅ 已实现 |
| 字体文件导出：OpenType（CFF，.otf），导出后用 fontkit 与浏览器字体引擎校验 | ✅ 已实现（限制见下文 / see limits） |
| TTF / WOFF / WOFF2 输出、字偶距与 OpenType 特性导出 | ❌ 不支持 Not supported |
| 声音 → 石刻逻辑 → 字形 Sound → Carving | ⏳ 规划中，未实现 Planned, not implemented |

形态变化参考：下图展示曲线字形向不同细节密度的多边形字形变化。

![字体曲线到多边形的形态变化参考](resources/reference/font_change_sample.png)

## Sound → Carving Logic → Letterform

Planned extension, **not implemented yet**: map Volume, Pitch, Rhythm, Duration, Frequency distribution, and Texture to Depth, Pressure, Stroke Width, Edge Roughness, Erosion, and Chisel Angle, then generate reproducible polygon letterforms. See the [product requirements](docs/PRD.md) and [implementation plan](docs/PHASE.md).

后续规划（尚未实现）：将声音特征转译为石刻参数，再作用于字形轮廓；支持可编辑映射、可读性约束及可复现导出。详细要求见[中文 PRD](docs/PRD.zh.md)和[中文实施计划](docs/PHASE.zh.md)。

## Development / 开发

Tech stack: Vite + React + TypeScript, with [fontkit](https://github.com/foliojs/fontkit) for font parsing and [opentype.js](https://github.com/opentypejs/opentype.js) for writing fonts (both loaded on demand). Requires Node.js 20.19+ (22 recommended).

技术栈：Vite + React + TypeScript；字体解析使用 fontkit，字体写入使用 opentype.js（均按需加载）。需要 Node.js 20.19 及以上（推荐 22）。

```bash
npm install       # 安装依赖
npm run dev       # 开发服务器：http://localhost:5173/
npm run build     # 类型检查 + 生产构建，输出到 dist/
npm run preview   # 预览生产构建：http://localhost:4173/None-Curve/
```

### Project structure / 目录结构

```text
src/
├── main.tsx, App.tsx      应用入口；App 持有状态（useReducer）并组装组件
├── components/            UI 组件：左上 ToolHead（ImportMenu、FontStatus）+ GeometryPanel（参数）、
│                          右上 CanvasViewport（文本样张 SpecimenView / 单字检查 GlyphView，共用 GlyphLayers
│                          与 usePanZoom）、左下 TextPanel、右下 GlyphPanel（GlyphPicker）、对话框等
├── font/                  字体加载与解析：本地文件、Google Fonts、Google Fonts URL 解析 googleUrl.ts、
│                          格式识别、fontkit 适配、排版、字形搜索
├── state/                 文档状态 + 参数状态、reducer、导入请求管理（useFontImport）、
│                          派生几何（useDerivedGeometry）与样张排版（useSpecimenScene），均不存入 reducer
├── geometry/              几何核心（纯 TypeScript，不依赖 React/DOM）：类型、曲线展平 flatten.ts、
│                          方形化 squaring.ts、锚点间距与简化 anchors.ts、网格吸附与角度锁定 constraints.ts、
│                          确定性顶点扰动 distortion.ts、
│                          派生流水线 pipeline.ts、共享几何缓存 cache.ts、SVG 路径工具
├── specimen/              样张排版：用最终多边形、字宽和字偶距排布文本（预览与导出共用）
├── export/                SVG 序列化、精度校验、OpenType 写入与回读校验、下载
└── styles.css
```

State is split into three layers (see `docs/PHASE.zh.md` §4): document state and parameter state live in `src/state/`; derived geometry is typed in `src/geometry/` and will be produced by a pipeline in later phases. React components only render state and dispatch actions; geometry algorithms must stay in `src/geometry/`.

状态分三层：文档状态与参数状态在 `src/state/`；派生几何的类型在 `src/geometry/`，由后续阶段的几何流水线生成。React 组件只负责展示和派发操作，几何算法不写进组件。

Conventions (e.g. the UI is English only) are recorded in [docs/BEST_PRACTICE.md](docs/BEST_PRACTICE.md).

约定（例如网页 UI 必须全英文）见 [docs/BEST_PRACTICE.md](docs/BEST_PRACTICE.md)。

Current status: the main font workflow is complete — import a font → edit any glyph with the full geometry pipeline → preview specimen text → export glyph or specimen SVG → export an OpenType font of the supported glyph set. Audio analysis, sound mapping, and carving are not implemented.

当前进度：主字体工作流已完成——导入字体 → 用完整几何流水线编辑任意字形 → 样张文本预览 → 导出字形或样张 SVG → 导出受支持字形集的 OpenType 字体。音频分析、声音映射和石刻尚未实现。

### Geometry pipeline / 几何流水线

```text
Original curves (frozen) → Flatten → Squaring → Anchor spacing → Anchor reduction → Grid snapping → Angle lock → Vertex distortion → final polygon
原始曲线（只读）          → 展平    → 方形化    → 锚点间距        → 锚点简化          → 网格吸附       → 角度锁定    → 顶点扰动          → 最终多边形
```

The order is fixed (`src/geometry/pipeline.ts`). Every parameter change reruns the whole pipeline from the original curves, so nothing accumulates, and turning a step off restores exactly the result of the steps before it. All distances are in font units and do not depend on canvas zoom. Because distortion runs last, it moves vertices off the snapping grid and off locked angles; to keep a grid or angle look, use a small amplitude.

扰动在最后执行，会让顶点离开吸附网格和锁定角度。

顺序固定；每次参数变化都从原始曲线重新运行整条流水线，所有距离均为字体单位，与画布缩放无关。

## Fonts / 字体导入

**Import font** sits at the top of the tools area (top left) and offers two sources. Both produce the same font model and preview.

左上功能区最上方的 **Import font** 提供两种来源，二者进入同一套字体模型和预览。

### Local files / 本地文件

- Formats / 格式：`.ttf`, `.otf` (TrueType and CFF outlines), `.woff`, `.woff2`. The format is detected from the file's bytes, not its extension. Font collections (`.ttc`/`.otc`) are not supported yet.
- Choose a file from the menu or drop it on the canvas. Files are read in the browser and never uploaded. Limit: 50 MB.
- Empty, unrecognized, and damaged files show distinct errors with a Retry button; the previously loaded font stays visible.

### Google Fonts

Previewing a family with CSS does not give access to outlines, so the app downloads the actual font file:

CSS 预览字体无法拿到轮廓数据，因此应用会下载真实字体文件再解析：

1. `GET https://fonts.googleapis.com/css2?family=<Family>:ital,wght@0,100;…;1,900` — the official CSS2 API, no API key. It returns only the styles that exist, one `@font-face` per subset. CORS is allowed.
2. `GET https://fonts.gstatic.com/s/<family>/<version>/<file>.woff2` for the chosen weight, style, and subset.
3. Parse the WOFF2 with fontkit. Only after this succeeds does the font become selectable in the glyph list.

Limits / 限制：

- **Catalog:** the full searchable catalog needs the Google Fonts Developer API key, which cannot be kept secret in a static Pages build. The dialog offers a curated list of 25 families, any family name typed exactly as on fonts.google.com (case-sensitive), or a pasted Google Fonts URL (below).
  完整目录需要 Developer API key，静态站点无法保密，因此提供精选列表、手动输入准确的 family 名称，或粘贴 Google Fonts URL。
- **Subsets:** Google splits families into per-subset files (latin, latin-ext, cyrillic, …). One subset is loaded at a time, so glyphs outside it are missing.
- **Variable fonts:** detected when several weights share one file. The outlines show the default instance; axis values (e.g. `wght`) are listed but cannot be chosen yet (fontkit cannot instantiate variations from WOFF2). Weight selection is disabled for these families.
- **Errors:** unknown families come back as HTTP 400 without CORS headers, which looks like a network error to the browser. The app re-checks with a `no-cors` request to tell "Google rejected the name" apart from "network / CORS / content blocker". Download and parsing errors are reported separately, all with Retry.
- The font version (e.g. `v20`) comes from the gstatic URL and is shown after loading.

#### Pasting a Google Fonts URL / 粘贴 Google Fonts 链接

Paste a link into the family field (`src/font/googleUrl.ts` parses it; the URL itself is never fetched — only the family and style are read from it and passed to the CSS2 flow above):

| URL | What is read |
|---|---|
| `https://fonts.google.com/specimen/Roboto` | Family (`+` = space). Query parameters such as `categoryFilters` or `preview.script` are ignored and listed. |
| `https://fonts.googleapis.com/css2?family=Roboto:ital,wght@1,700` | Family, weight, and italic from the first style tuple. A weight range (`wght@300..700`) means the default instance. |
| `https://fonts.googleapis.com/css?family=Lato:300italic` | Legacy API: family and first style (`400`, `700italic`, `300i`, `bold`). |

- Only `https://` URLs on `fonts.google.com` and `fonts.googleapis.com` are accepted. Other hosts, look-alike domains, `http://`, credentials, ports, and other paths (e.g. `/icon`) are rejected with an explanation, so the field cannot be used to request arbitrary URLs.
  仅接受 https 且域名为 fonts.google.com / fonts.googleapis.com 的链接，其余一律拒绝。
- If a URL lists several families or styles, the first is used and the dialog says so. `display`, `subset`, `text`, and tracking parameters are ignored and listed.
- Axes other than `wght` and `ital` (for example `opsz`, `wdth`) cannot be applied; the dialog states they are ignored and that the default instance will be loaded.
- Requested styles that the family lacks fall back to the default rule (closest to 400), and the dialog names the style that will actually load. For variable families a requested weight cannot be applied (all weights share one file), which the dialog also states.
- Unknown families, network / CORS failures, download failures, and parse failures show their own messages with Retry. A font only appears as imported after its file has been downloaded and parsed.

## Squaring / 方形化

Flattening alone only approximates the original curves, so even a coarse tolerance keeps an O round. **Squaring** (`src/geometry/squaring.ts`) deliberately reshapes round contours toward their bounding rectangle, so a round O — and its counter — can become square.

- How it works: each contour is normalized to its own bounding box. Every point moves radially from the box centre toward the box edge: at 100 % it lands exactly on the box (scale `1 / max(|u|, |v|)`), so a circle, ellipse, or superellipse becomes its bounding rectangle with flat sides; corner points are inserted so the corners are sharp. The amount (0–100 %, step 5 %, presets Off / Soft / Square) blends linearly between the curve and the rectangle. It is defined in each contour's own normalized box, so it does not depend on zoom or units per em.
  每个轮廓按自身包围盒归一化，点沿中心方向移向包围盒边缘；100% 时圆、椭圆、超椭圆都变成包围矩形。强度 0–100% 线性过渡。
- Counters: a counter uses its own box, so it becomes a smaller concentric rectangle. Stroke thickness at the side midpoints (where the outline already touches its box) is unchanged — for Roboto O the left stem stays 191 units and the bottom 163 units at 100 %.
  字腔用自己的包围盒，变成同心的小矩形，笔画在四边中点的厚度不变。
- Scope **Round contours** (default): only contours close to the ellipse that fills their box are squared (edge-weighted mean deviation ≤ 0.06 squares fully, ≥ 0.16 not at all, linear in between). Bowls and counters of O, o, 0, 8, g become squares; stems, triangles (A), S-curves, and D- or B-shaped contours stay as they are. **All contours** pushes every contour toward its box and can distort strongly; contours that would fail validation keep their previous shape.
- Order: right after flattening, so **Anchor reduction** can then remove the collinear points left on the straight sides (a squared O reduces to 4 corners plus its start point).
- Safety: each squared contour must keep at least three distinct points, its direction, non-zero area, and no more self-crossings; otherwise it keeps its pre-squaring shape and the panel names the reason. **Original** always shows the untouched curves, and **Compare** overlays them.
- Measured (area ÷ bounding-box area; a square is 1.00, a circle about 0.79): at 100 % the O, o, and 0 of Roboto, Inter, and Andale Mono — outer contour and counter — all reach 1.00. B, A, S, D, and e keep their non-round contours.

## Curve flattening / 曲线展平

Every quadratic and cubic segment is replaced by straight edges (`src/geometry/flatten.ts`). The result is a polygon made only of `M`, `L`, and `Z` commands. All math runs in font units, so canvas zoom never changes the result. Each parameter change rebuilds the polygon from the original curves, which are frozen and never modified.

每条二次 / 三次曲线被替换为直线段，结果只含 `M`、`L`、`Z`。计算全部在字体单位中进行，与画布缩放无关；每次参数变化都从冻结的原始曲线重新生成，不会累积误差。

Two exclusive modes / 两种互斥模式：

- **Adaptive (tolerance)** — recursive midpoint subdivision (de Casteljau). A sub-curve becomes one edge once an upper bound on its distance from the chord is within the tolerance: half the control point's distance for a quadratic, ¾ of the larger control distance for a cubic. Strong bends get more edges, flat parts fewer. Tolerance range: 0.1–100 font units (logarithmic slider). Safety limits: recursion depth 12 (≤ 4096 edges per curve) and a 0.01-unit minimum sub-curve length; curves that hit a limit are reported.
  自适应：递归中点细分，直到曲线与弦的最大偏差上界 ≤ 容差。容差越小，越贴近原曲线、顶点越多。设有递归深度与最小长度上限，防止病态输入。
- **Fixed segments** — each curve is sampled at `t = i/N` and becomes exactly N edges (1–32). Straight source segments are kept as single edges. A warning appears if any edge strays more than 1% of the em from its curve.
  固定线段数：每条曲线按 `t = i/N` 采样为 N 段。
- **Merge joined curves** (fixed mode, off by default; `src/geometry/curveRuns.ts`) — fonts build one visible curve out of several Bézier segments (TrueType especially, where consecutive off-curve points create implied on-curve points: a Roboto O has 16 curve segments per contour). Without merging, “N per curve” applies to each small segment, so the outline stays smooth even at N = 1–2. Merging joins consecutive curve segments that meet smoothly into one curve and samples the whole merged curve with N edges spaced evenly by arc length — the “4 / 3 / 2 lines per curve” look.
  合并相连曲线：把平滑相接的多段曲线视为一条曲线，再按弧长均匀分成 N 段，从而得到明显的折面效果。
  - **Break merged curves at** — **Corners & extremes** (default): breaks at corners, straight segments, and wherever the curve is horizontal or vertical (its leftmost, rightmost, top, and bottom points, found analytically even inside a segment), so a round bowl splits into quarter arcs. **Corners only**: breaks only at corners and straight segments; a fully smooth loop (an O) becomes one curve and uses at least 3 edges.
    断开规则：默认在尖角与极值点断开（圆弧分成四分之一弧）；也可只在尖角断开。
  - **Corner angle** (1–90°, default 15°): a joint that turns by more than this is a corner and always breaks. Merged curves also break at the contour start so the start point is kept.
  - Measured on Roboto `a`: 38 curve segments merge into 12 curves; N = 4 / 3 / 2 / 1 gives 57 / 45 / 33 / 21 vertices (47 without merging even at N = 1).
  - Safety: a merged contour must keep at least three points, its direction, non-zero area, and no more self-crossings than the unmerged result; otherwise that contour uses the unmerged fixed result and the panel reports it (for example `a` with Corners only at N = 1). The 1 %-of-em deviation warning is suppressed while merging, since the coarse shape is intended.

Contours keep their start point, order, and direction (so counters stay holes), closure is implicit, and advance width and side bearings are copied unchanged. Glyphs without contours (e.g. space) produce an empty polygon; contours that collapse below three points are omitted and reported. The panel shows vertex count, curve count, and the largest deviation measured at each edge's parametric midpoint.

## Anchor spacing and reduction / 锚点间距与简化

Both run after flattening and can be set independently (`src/geometry/anchors.ts`). 0 turns either one off; **Reset anchors** turns both off.

- **Anchor spacing** (0–200 font units, step 1; values below 1 u are raised to 1 u): every edge, including the closing edge back to the start, is split into equal parts no longer than the target. New points lie exactly on the existing edges, so the shape is unchanged; the start point is not repeated and no zero-length edges are created. If the result would exceed 50,000 vertices for the glyph, spacing is skipped and a warning is shown.
  锚点间距：把每条边（含闭合边）等分到不超过目标长度，新点落在原边上，不改变形状。
- **Anchor reduction** (0–100 font units, step 0.5): Ramer–Douglas–Peucker on each closed contour. The ring is split at its start point (always kept, so the start stays the same) and at the vertex farthest from it; both halves are simplified with fixed ends, which keeps detail at the closing edge. A vertex is removed when it lies within the threshold of the simplified outline. The panel shows the largest distance from a removed vertex to the outline.
  锚点简化：对闭合轮廓做 RDP。阈值越大，删除越多点，**可能抹掉小细节、角点和细部**。
- Safety: a reduced contour must keep at least three distinct points, the same winding direction (so counters stay holes), non-zero area, and no more self-crossings than before. Some fonts already contain self-crossing contours (for example overlapping outlines exported from variable fonts); those crossings are kept but none are added. If a check fails, that contour keeps its unreduced points and the panel reports the fallback.
- The panel shows the vertex count after each step: Flattened → Spacing → Reduction.

Known limits / 已知限制：

- Because the order is fixed, reduction removes spacing points again whenever both are on: spacing points are collinear with their edge. The panel warns about this.
  顺序固定，两者同时开启时，简化会把间距插入的共线点再次删除。
- Crossings are checked within each contour, not between different contours, so a large threshold can make a counter touch the outer contour.
- Reduction thresholds are absolute font units; the same value has a stronger effect on fonts with a small units-per-em.

## Grid snapping and angle lock / 网格吸附与角度锁定

Both run after anchor reduction and can be switched on independently (`src/geometry/constraints.ts`). **Reset grid & angles** restores the defaults (both off, grid 10 u, 45°).

- **Grid snapping** (grid size 0–200 font units, step 1; 0 = off): each coordinate becomes `round(v / g) × g`. The grid is anchored at the glyph origin (0, 0), so the baseline and the left edge of the advance box are grid lines; exact halves round toward +∞ (`Math.round`). Consecutive vertices that land on the same grid point are merged (no zero-length edges); the first vertex stays first and is never duplicated at the end. While snapping is on, the canvas draws the grid in font units for reference; it is display only and never part of the polygon. Grids denser than 4 screen pixels are not drawn, and the canvas says so.
  网格吸附：坐标取 `round(v / g) × g`，网格以字形原点为基准；正好一半时向 +∞ 取整；相邻重合点合并。
- **Angle lock** (presets: multiples of 90°, 45°, 30°, or 15°): directions are measured counter-clockwise from horizontal in y-up font space. Each edge turns to the nearest allowed direction; an exact tie picks the counter-clockwise one. Rotating edges one by one would break the outline, so the directions are fixed first and then only edge **lengths** are adjusted: the weighted least-squares change (weights proportional to edge length, so long edges absorb more) that makes the edge vectors sum to zero. The start vertex is the fixed reference and every other vertex is rebuilt from the adjusted edges, so the contour stays connected and closed.
  角度锁定：每条边取最近的允许方向（等距时取逆时针方向），再以加权最小二乘只调整边长使轮廓重新闭合；起点固定，其余顶点由边依次重建。
- When both are on, snapping runs first; angle lock then changes edge lengths, so some vertices leave the grid. The panel warns about this.
  两者同时开启时先吸附后锁角，锁角后部分顶点会离开网格。

Fallback / 回退：each step validates every contour. If a contour would collapse (fewer than three distinct points or zero area), reverse its direction, gain self-crossings, or — for angle lock — have no closed solution with positive edge lengths (for example a triangle under the 90° preset), that contour keeps the points from before the step. The panel lists the affected contours and the reason.

## Vertex distortion / 顶点扰动

Deterministic noise moves the final vertices (`src/geometry/distortion.ts`). **Reset distortion** restores the defaults (amplitude 0).

- **Noise amplitude** (0–200 font units, step 1): the largest distance a vertex can move. 0 turns distortion off and returns the previous step's polygon unchanged.
- **Noise frequency** (0.5–50, step 0.5): noise features per 1000 font units of outline length (wavelength ≈ 1000 / f units). The noise is sampled by arc length, so it does not depend on zoom or on how many vertices the outline has. Each contour gets a whole number of noise cells around its loop, which makes the noise periodic: there is no seam where the contour closes.
- **Normal bias** (0–100 %): 0 % slides vertices along the outline (tangent), 100 % pushes them across it (normal), values in between mix two independent noise channels. The tangent at each vertex comes from its previous and next neighbours, wrapping around the closed contour. The mix is normalized so the largest offset equals the amplitude.
- **Seed** (integer 0–999,999) and **Next variant** (seed + 1).

Determinism / 确定性：no `Math.random`, time, or render count is involved. Each lattice value is an integer hash (murmur3-style) of the seed, the contour index, the channel (normal / tangent), and the lattice cell; a vertex samples that noise at its arc-length position on the contour. The same glyph, parameters, contour order, point order, and seed always give the same polygon — across redraws, view switches, and re-selecting the glyph.
相同字形、参数、轮廓与点序及 seed 必然得到相同结果；不使用 Math.random 或时间。

Protection and fallback / 保护与回退：

- Edge protection: the two ends of an edge may move relative to each other by at most half the edge's length; otherwise both displacements are shortened. Every edge therefore keeps at least half its length and its direction (no zero-length edges or fold-backs at short edges and sharp turns). The panel counts the shortened vertices.
- Each contour is then validated (closed, same direction, non-zero area, no more self-crossings than before). If it fails, the amplitude for that contour is retried at 50 % and 25 %; if all fail, the contour stays undistorted. Both cases are reported.

Known limits / 已知限制：

- High frequency on a dense outline (for example after anchor spacing) moves neighbouring vertices in different directions, so edge protection can reduce the visible amplitude a lot. The panel shows the actual largest move.
- Crossings between different contours are not checked; a large amplitude can make a counter touch the outer contour.
- Distortion changes detail and can hurt legibility.

The polygon is derived with `useMemo` from the selected glyph and the flatten, anchor, grid, and distortion parameters (all deferred with `useDeferredValue` so fast slider drags stay responsive); it is never stored in reducer state. If flattening fails, the canvas shows the error and the original outline instead of crashing.

### Layout / 布局

```text
┌────────────────────────┬──────────────────────────────────────┐
│ Tools                  │ C  Result canvas                      │
│ Import · font info     │    text specimen or one glyph         │
│ Parameters (scroll)    │                                       │
├────────────────────────┼──────────────────────────────────────┤
│ B  Text input          │ A  Glyph preview and selection        │
└────────────────────────┴──────────────────────────────────────┘
```

- **Top left — tools:** **Import font** and the font information (source, format, glyph count, variable axes) come first, followed by every geometry parameter (flattening, squaring, anchors, grid & angles, distortion, export) in pipeline order. The parameter statistics refer to the selected glyph.
- **Top right — C:** the only result canvas. It shows the text from B set with the current font and all parameters, or — after choosing a glyph in A, or pressing **Glyph** — a single glyph for inspection. **Text** returns to the specimen; selecting a glyph never clears the text in B. Clicking a glyph in the specimen selects it without leaving the text view. A newly loaded font opens on the text view.
- **Bottom left — B:** the editable text (multi-line), sample texts, character count, kerning status, and missing characters.
- **Bottom right — A:** glyph previews only — a searchable grid (characters or all glyphs) with large cells. No import controls live here.
- Narrow screens stack: import and font info, C (at least 62 % of the viewport height), parameters (collapsed; **Parameters** in the canvas toolbar opens them), B, then A.

田字形布局：左上为功能区（导入、字体信息、全部参数），右上为结果画布 C，左下为文本输入 B，右下只展示字形预览与选择 A。窄屏纵向排列，参数可折叠。

### Canvas / 画布

- Outline view: **Original** (font curves), **Flattened** (polygon), **Compare** (polygon fill and solid edges with the original curves overlaid as a dashed line). The current view is shown in the canvas corner and the status bar.
  轮廓视图：原始曲线 / 展平多边形 / 叠加对比。
- Layers: **Fill** (off = outline stroke), **Skeleton** (original on-curve anchors as squares, off-curve controls as hollow circles, handles), **Vertices** (generated polygon vertices as green dots), and **Metrics**. The skeleton draws on-curve anchors (squares), off-curve control points (circles), and handles. TrueType quadratic curves show the implied on-curve points between consecutive control points as anchors.
- Zoom with the mouse wheel or `+` / `−`, pan by dragging or with arrow keys (canvas focused), `0` or **Fit** to reset. The same controls work for the text specimen and the single-glyph inspector.
- In the text specimen all layers apply to every glyph. Only glyphs inside the visible area are drawn. Skeleton points and vertices appear once an em is at least 48 px on screen; below that the canvas asks you to zoom in, so long texts stay readable. Metric labels are drawn on the first visible line only.
- Metric guides: ascender, cap height, x-height, baseline, descender, and the advance width.

## Specimen / 样张

The text from area B is set in canvas C with the final polygons from the shared geometry cache, so the specimen, the single-glyph inspector, and the exports always agree.

- Spacing: each glyph advances by its advance width, plus kerning when the font has it (GPOS `kern` feature or a legacy `kern` table, applied through fontkit's layout). Ligatures are turned off so every character keeps its own glyph. Fonts without kerning data are labeled as such; nothing is invented.
- Line height: ascender − descender + the font's line gap. Spaces advance without drawing.
- Missing characters are drawn as dashed boxes and listed; the rest of the line still renders.
- **Fit** shows the whole text; zoom and pan to read long texts.
- Click a glyph in the specimen to select it. Changing any geometry parameter updates the specimen.
- Up to 1000 characters are shown. Each distinct glyph is processed once per parameter set (cache key: font, glyph, and all geometry parameters), so repeated characters cost nothing extra.

样张：在 B 区输入文本，在 C 区用与单字检查相同的最终多边形排布；按字宽和字体自带的字偶距排布（无字偶距数据时明确标注），关闭连字，空格只推进不绘制，缺字以虚线框标出并列出，点击样张中的字形可选中它。

## Export / 导出

Open **Export…** from the header or the toolbar. Nothing is downloaded until you press a download button; importing a font or changing parameters never downloads anything. Every export uses the same cached final polygons as the canvas.

导出入口在顶部栏和左上参数区底部；只有点击下载按钮才会下载，导出内容与画布显示的最终多边形完全一致。

### SVG

- **Current glyph** or **specimen text**. Paths use only `M`, `L`, and `Z`, with `fill-rule="nonzero"`; contour order and direction are kept, so counters stay holes.
- Units are font units. The glyph viewBox is the advance box from descender to ascender, grown to include any overshoot; the specimen viewBox covers every line. Kerning and line breaks are kept exactly as in the preview. Missing characters are left as blank advances and named in an XML comment.
- **Coordinate precision**: 0–4 decimal places. After rounding, every contour must keep at least three distinct points, its direction, non-zero area, and no new self-crossings; otherwise the export stops and asks for a higher precision.
- Text in `<title>` / `<desc>` is XML-escaped and invalid XML characters are removed. File names are reduced to ASCII letters, digits, `.`, `-`, and `_`.

### Font file / 字体文件

- Format: **OpenType with CFF outlines (`.otf`)**, written with opentype.js (MIT; chosen because fontkit can only read fonts). Output is in a separate chunk loaded only when you build a font.
- Glyph set: the current glyph, the characters in the specimen, or all mapped characters of the font (up to 5000 glyphs), plus a `.notdef` box. Every glyph is processed with the current pipeline from its read-only source curves — the same code and cache as the canvas.
- Naming: family and style name (printable ASCII). The default family name adds “Poly”; check the source font's license before sharing a modified font.
- Kept: character mapping (all code points that map to a glyph), advance widths, contour order and direction, counters, units per em, ascender, and descender. Outlines keep their position relative to the glyph origin, so side bearings are those of the final polygon (snapping, angle lock, or distortion can shift them slightly).
- Checks before writing: character mapping, empty glyphs, glyph count, advance widths (0–65535), coordinates (±32767), and contour validity after rounding to whole font units. Glyphs that cannot be stored safely are left out and listed by name with the reason.
- **Build & verify**, then **Download .otf**. After writing, the file is reopened with fontkit — a separate parser — and compared with what was meant to be written: OpenType/CFF signature, family name, glyph count, every character mapping, every advance width, and every contour point by point including its direction. It is then loaded through the browser's own font engine (`FontFace`, which runs the OTS sanitizer in Chrome and Firefox). If any check fails, no download is offered. Changing a parameter after building requires a new build.

Not included / 不包含：

- TrueType (`.ttf`), WOFF, and WOFF2 output.
- Kerning, ligatures, mark positioning, and every other OpenType layout feature (GPOS / GSUB); hinting; color and vertical tables.
- Variation axes: a variable font is exported as the default instance shown on the canvas.
- Glyphs reachable only through layout features (not through the character map).
- Characters above U+FFFF: the writer cannot map them reliably (read-back verification caught this), so they are left out and listed.
- Coordinates are rounded to whole font units, as CFF output requires.

## Deploy to GitHub Pages / 部署

- **Release branch / 发布分支：** `main`. The workflow `.github/workflows/deploy.yml` runs only on pushes to `main` (or a manual run on `main`). Pushes to `develop` or `feature/*` never deploy.
  仅 `main` 分支会部署；`develop` 和 `feature/*` 的 push 不会触发发布。
- **Base path / 资源路径：** production builds use `/None-Curve/` (set in `vite.config.ts`). If the repository is renamed, update `pagesBase`. Assets imported from `src/` get the base automatically; files placed in a `public/` folder must be referenced relative to the base (e.g. `import.meta.env.BASE_URL`).
  生产构建使用 `/None-Curve/`。仓库改名时需同步修改 `vite.config.ts` 中的 `pagesBase`。

Steps / 步骤：

1. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
   在仓库 **Settings → Pages** 中，将 **Source** 设为 **GitHub Actions**。
2. Merge into `main` and push (or run **Deploy to GitHub Pages** from the **Actions** tab with `main` selected). The workflow runs `npm ci`, `npm run build`, and publishes `dist/`.
   合并到 `main` 并推送，或在 **Actions** 页面选择 `main` 手动运行。工作流会执行 `npm ci`、`npm run build` 并发布 `dist/`。
3. URL format / 访问地址：`https://<owner>.github.io/<repo>/`, i.e. `https://m1ingx1xx1.github.io/None-Curve/`.
