# None-Curve

An experimental web app for turning font curves into editable polygon shapes. Load a font to see its glyphs rendered live, then adjust the controls on the left and watch the outlines update on the canvas. The font editor is the primary tool; an optional audio-driven carving tool lets you shape glyphs from sound. Export only when you’re ready.

## 中文

一个将字体曲线转换成可编辑多边形的实验性网页工具。载入字体后即可看到字形的实时预览，在左侧调整控制项，画布中的轮廓会随之更新。字体编辑器是核心功能，并提供可选的声音驱动石刻工具；准备好后再手动导出作品。

形态变化参考：下图展示曲线字形向不同细节密度的多边形字形变化。

![字体曲线到多边形的形态变化参考](resources/reference/font_change_sample.png)

## Sound → Carving Logic → Letterform

Planned extension: map Volume, Pitch, Rhythm, Duration, Frequency distribution, and Texture to Depth, Pressure, Stroke Width, Edge Roughness, Erosion, and Chisel Angle, then generate reproducible polygon letterforms. See the [product requirements](docs/PRD.md) and [implementation plan](docs/PHASE.md).

新增规划：将声音特征转译为石刻参数，再作用于字形轮廓；支持可编辑映射、可读性约束及可复现导出。详细要求见[中文 PRD](docs/PRD.zh.md)和[中文实施计划](docs/PHASE.zh.md)。

## Development / 开发

Tech stack: Vite + React + TypeScript, with [fontkit](https://github.com/foliojs/fontkit) for font parsing (loaded on demand). Requires Node.js 20.19+ (22 recommended).

技术栈：Vite + React + TypeScript，字体解析使用 fontkit（按需加载）。需要 Node.js 20.19 及以上（推荐 22）。

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
├── components/            UI 组件：ControlPanel（左侧工具栏：ImportMenu、FontStatus、GlyphPicker、
│                          UpcomingTools）、CanvasViewport / GlyphView、GoogleFontsDialog 等
├── font/                  字体加载与解析：本地文件、Google Fonts、格式识别、fontkit 适配、字形搜索
├── state/                 文档状态 + 参数状态、reducer、导入请求管理（useFontImport）
├── geometry/              几何核心类型与原始曲线路径工具，不依赖 React
└── styles.css
```

State is split into three layers (see `docs/PHASE.zh.md` §4): document state and parameter state live in `src/state/`; derived geometry is typed in `src/geometry/` and will be produced by a pipeline in later phases. React components only render state and dispatch actions; geometry algorithms must stay in `src/geometry/`.

状态分三层：文档状态与参数状态在 `src/state/`；派生几何的类型在 `src/geometry/`，由后续阶段的几何流水线生成。React 组件只负责展示和派发操作，几何算法不写进组件。

Conventions (e.g. the UI is English only) are recorded in [docs/BEST_PRACTICE.md](docs/BEST_PRACTICE.md).

约定（例如网页 UI 必须全英文）见 [docs/BEST_PRACTICE.md](docs/BEST_PRACTICE.md)。

Current status: font import → glyph selection → outline and source-curve skeleton preview works. Flattening, polygon editing, distortion, specimen text, audio analysis, carving, and export are not implemented; their controls are disabled and labeled.

当前进度：已实现“导入字体 → 选择字形 → 查看填充轮廓与原始曲线骨架”。曲线展平、多边形编辑、扰动、样张文本、音频分析、石刻和导出尚未实现，相关控件均为禁用并有标注。

## Fonts / 字体导入

**Import** sits at the top of the left toolbar and offers two sources. Both produce the same font model and glyph preview.

左侧工具栏最上方的 **Import font** 提供两种来源，二者进入同一套字体模型和字形预览。

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

- **Catalog:** the full searchable catalog needs the Google Fonts Developer API key, which cannot be kept secret in a static Pages build. The dialog offers a curated list of 25 families plus any family name typed exactly as on fonts.google.com (case-sensitive).
  完整目录需要 Developer API key，静态站点无法保密，因此只提供精选列表 + 手动输入准确的 family 名称。
- **Subsets:** Google splits families into per-subset files (latin, latin-ext, cyrillic, …). One subset is loaded at a time, so glyphs outside it are missing.
- **Variable fonts:** detected when several weights share one file. The outlines show the default instance; axis values (e.g. `wght`) are listed but cannot be chosen yet (fontkit cannot instantiate variations from WOFF2). Weight selection is disabled for these families.
- **Errors:** unknown families come back as HTTP 400 without CORS headers, which looks like a network error to the browser. The app re-checks with a `no-cors` request to tell "Google rejected the name" apart from "network / CORS / content blocker". Download and parsing errors are reported separately, all with Retry.
- The font version (e.g. `v20`) comes from the gstatic URL and is shown after loading.

### Canvas / 画布

- **Fill**, **Skeleton**, and **Metrics** layers. The skeleton draws on-curve anchors (squares), off-curve control points (circles), and handles. TrueType quadratic curves show the implied on-curve points between consecutive control points as anchors.
- Zoom with the mouse wheel or `+` / `−`, pan by dragging or with arrow keys (canvas focused), `0` or **Fit** to reset.
- Metric guides: ascender, cap height, x-height, baseline, descender, and the advance width.

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
