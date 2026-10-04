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

Tech stack: Vite + React + TypeScript. App source lives in `src/`. Requires Node.js 20.19+ (22 recommended).

技术栈：Vite + React + TypeScript，应用源码位于 `src/`。需要 Node.js 20.19 及以上（推荐 22）。

```bash
npm install       # 安装依赖
npm run dev       # 本地开发服务器，默认 http://localhost:5173/
npm run build     # 类型检查并构建到 dist/
npm run preview   # 本地预览构建结果，http://localhost:4173/None-Curve/
```

The current app is a scaffold only: font loading, curve processing, audio analysis, carving mapping, and import/export are placeholders.

当前仅为基础脚手架：字体解析、曲线处理、音频分析、石刻映射与导入导出均为占位状态。

## Deploy to GitHub Pages / 部署

The production build uses the base path `/None-Curve/` (see `vite.config.ts`). If the repository is renamed, update `base` to match.

生产构建使用 `/None-Curve/` 作为资源基础路径（见 `vite.config.ts`）；如果仓库改名，需要同步修改 `base`。

1. In the GitHub repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
   在仓库 **Settings → Pages** 中，将 **Source** 设为 **GitHub Actions**。
2. Push to `main` (or run the **Deploy to GitHub Pages** workflow manually from the **Actions** tab). The workflow in `.github/workflows/deploy.yml` installs dependencies, builds, and publishes `dist/`.
   推送到 `main`，或在 **Actions** 页面手动运行 **Deploy to GitHub Pages**。工作流会安装依赖、构建并发布 `dist/`。
3. The site is served at `https://<user>.github.io/None-Curve/`.
   部署完成后访问 `https://<user>.github.io/None-Curve/`。
