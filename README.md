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

Tech stack: Vite + React + TypeScript. Requires Node.js 20.19+ (22 recommended).

技术栈：Vite + React + TypeScript。需要 Node.js 20.19 及以上（推荐 22）。

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
├── components/            UI 组件：Header、Workspace、ControlPanel、CanvasViewport、
│                          GlyphStrip、FileDropTarget、StatusBar
├── state/                 文档状态 + 参数状态的类型、初始值与 reducer
├── geometry/              几何核心类型（原始曲线、参数、规范多边形），不依赖 React
└── styles.css
```

State is split into three layers (see `docs/PHASE.zh.md` §4): document state and parameter state live in `src/state/`; derived geometry is typed in `src/geometry/` and will be produced by a pipeline in later phases. React components only render state and dispatch actions; geometry algorithms must stay in `src/geometry/`.

状态分三层：文档状态与参数状态在 `src/state/`；派生几何的类型在 `src/geometry/`，由后续阶段的几何流水线生成。React 组件只负责展示和派发操作，几何算法不写进组件。

Conventions (e.g. the UI is English only) are recorded in [docs/BEST_PRACTICE.md](docs/BEST_PRACTICE.md).

约定（例如网页 UI 必须全英文）见 [docs/BEST_PRACTICE.md](docs/BEST_PRACTICE.md)。

Current status: Phase A (architecture) only. Font import, glyph parsing, flattening, geometry editing, audio analysis, carving, and export are UI placeholders and shown as disabled.

当前进度：仅完成阶段 A（架构与基础界面）。字体导入与解析、曲线展平、几何编辑、音频分析、声音映射、石刻效果和导出均为禁用的界面占位。

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
