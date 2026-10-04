# 项目约定

[English](BEST_PRACTICE.md) · **中文**

None-Curve 的工作约定。修改应用或文档时请遵守。

## 应用界面语言

- **网页界面只用英文。** 用户能看到或听到的地方都不得出现中文（或其他中日韩文字）：可见文字、按钮、占位文字、`title`、`aria-label`、`alt`、错误信息以及页面 `<title>`。
- `src/` 下的所有源码（包括代码注释）也保持英文，这样可以用命令自动检查。

提交前运行（不应有任何输出）：

```bash
grep -rnP '[\x{3000}-\x{9fff}\x{ff00}-\x{ffef}]' src index.html
```

## 文档语言

- 每份文档都分为**独立的英文版和中文版**，不要在同一个文件里混用两种语言。
- 默认为英文：`NAME.md` 是英文版，`NAME.zh.md` 是中文版。
- 每个版本开头都放语言切换链接，指向另一个版本，例如 `[English](NAME.md) · **中文**`。
- 修改其中一个版本时，在同一次改动中同步更新另一个版本。
- 中文文档提到界面元素时使用界面上的英文名称（界面是英文的），必要时附中文解释。

现有的文档对：`README.md` / `README.zh.md`、`docs/USER_GUIDE.md` / `docs/USER_GUIDE.zh.md`、`docs/PRD.md` / `docs/PRD.zh.md`、`docs/PHASE.md` / `docs/PHASE.zh.md`、`docs/BEST_PRACTICE.md` / `docs/BEST_PRACTICE.zh.md`。
