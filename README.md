# None-Curve

An experimental web app for turning font curves into editable polygon shapes. The font editor is the primary tool; an optional audio-driven carving tool lets you shape glyphs from sound. Inspect a glyph’s original points, explore different levels of detail, and export your results as SVG or a font file.

## 中文

一个将字体曲线转换成可编辑多边形的实验性网页工具，字体编辑器是核心功能，并提供可选的声音驱动石刻工具。你可以查看字形原有的锚点和控制点、调整轮廓细节，也可以用声音塑造字形。作品可导出为 SVG 或字体文件。

## Sound → Carving Logic → Letterform

Planned extension: map Volume, Pitch, Rhythm, Duration, Frequency distribution, and Texture to Depth, Pressure, Stroke Width, Edge Roughness, Erosion, and Chisel Angle, then generate reproducible polygon letterforms. See the [product requirements](docs/PRD.md) and [implementation plan](docs/PHASE.md).

新增规划：将声音特征转译为石刻参数，再作用于字形轮廓；支持可编辑映射、可读性约束及可复现导出。详细要求见[中文 PRD](docs/PRD.zh.md)和[中文实施计划](docs/PHASE.zh.md)。
