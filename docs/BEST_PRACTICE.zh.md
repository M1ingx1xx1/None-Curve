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

现有的文档对：`README.md` / `README.zh.md`、`docs/USER_GUIDE.md` / `docs/USER_GUIDE.zh.md`、`docs/PRD.md` / `docs/PRD.zh.md`、`docs/PHASE.md` / `docs/PHASE.zh.md`、`docs/BEST_PRACTICE.md` / `docs/BEST_PRACTICE.zh.md`、`docs/EXPERIMENTAL_PLAN.md` / `docs/EXPERIMENTAL_PLAN.zh.md`、`docs/SOUND_PLAN.md` / `docs/SOUND_PLAN.zh.md`。

## 测试

- 测试放在 `tests/` 下，按领域分目录（`tests/geometry`、`tests/export`、`tests/font`、`tests/sound`、`tests/state`、`tests/worker`）；慢的测试放在 `tests/slow`。
- `npm test` 运行快速测试（约 15 秒）。`npm run test:slow` 运行慢速测试（完整的 42 秒 Sound 测试音轨，以及两种测试字体的全部字形；约 3 分钟），只有点名要求时才运行。
- `npm run build` 也会对测试和脚本做类型检查（`tsconfig.test.json`）。
- 向 `develop` 提交 pull request 之前先运行 `npm test`。CI 在每个提交到 `develop` 的 pull request 和每次推送到 `develop` 时运行 `npm test` 和 `npm run build`；Pages 部署也会先运行 `npm test` 再构建。
- 测试字体只用开源授权的字体（OFL：STIX Two Text 和 Roboto），每个字体旁边都放着它的 `OFL-*.txt`，位于 `tests/fixtures/fonts`。不要加入不允许再分发的字体。
- 发现 `src/` 里 bug 的测试要保留下来，写成 `it.skip`，并加一条 `BUG:` 注释说明问题，直到 bug 修好为止。
- 生成的文件不提交。Sound 测试音轨由 `npm run test-track`（来自 `scripts/test-track.ts`）渲染为 `test-audio/sound-test.wav`，git 会忽略它；有一个测试检查它每次渲染出的采样都相同。

## 几何计算与 Worker

- 字形几何只在几何 Worker 里计算（`src/geometry/geometry.worker.ts`，逻辑在 `workerCore.ts`），从不在页面上计算。画布、文字预览、Sound 的实时帧以及 SVG 和 PNG 导出，都通过页面端的客户端（`src/state/geometryClient.ts`）请求：导出用 `ensure()`，实时帧用 `prefetch()`。不要加主线程的后备方案；Worker 无法运行时，画布会说明并请用户刷新页面。
- 协议（`src/geometry/protocol.ts`）：每个计算请求都有一个 id，并且在任何路径上（包括 Worker 没有这个字体时）都以恰好一个回答结束：`done`（如果被更新的请求或 `cancel` 在字形之间停下，则带 `stopped`）或 `failed`（带原因）。Worker 在每个字形之前发送 `glyph`：这是页面的心跳，也说明出问题时该怪哪个字形。新增的消息类型也要遵守这些规则。
- 客户端：Worker 在一个字形上 60 秒没有消息时，这个字形被标为失败（"Took longer than 60 s; try lighter settings"），Worker 重启并重新发送字体；60 秒内重启超过 3 次时，几何计算停止，直到换下一个字体，画布会说明原因。新的设置会替换卡在一个已不需要的字形上 750 毫秒以上的 Worker（每 2 秒最多一次，实时帧除外）。要让重度设置变快，应像 Experimental 的顶点预算那样在流程内部解决（EXPERIMENTAL_PLAN 第 4.10 节），而不是放宽这些限制。
- 字体导出每次构建都在自己的 Worker 里运行（`src/export/fontExport.worker.ts`）。Cancel 会立即终止它，一分钟没有进度时也会终止。只有这个 Worker 无法启动时，构建才在页面上运行。
- 不用浏览器测试 Worker 的逻辑和客户端：`tests/worker` 用假的 `post` 运行 `workerCore`，用假 Worker 和假计时器测试客户端。

## 滑块范围

- 每个 Geometry 和 Experimental 滑块的范围和档位只写一次，写在 `src/state/sliderScales.ts` 里：`SLIDER_RANGES`，按滑块的 Sound 目标 id 索引（`"group.key"`、`"experimental.effect.key"`）；对数刻度的 Tolerance 滑块用 `TOLERANCE`。
- 面板把这一项展开到它的 range 输入上（或在 `RangeField` 上写明目标），Sound（`src/sound/mapping.ts`）和保存会话的检查也读同一项，所以实时值和恢复的值总是滑块自己能给出的值。
- 不要在别处再写滑块的最小值、最大值或档位；要改范围，就改这一项。新滑块先在这里加一项。`sliderRange(id)` 遇到没有的 id 会抛错，所以拼写错误会立刻暴露。

## 保存设置与撤销

- 会话（设置、画布视图按钮、文字、预览的外观、导出精度、Sound 映射，以及打开的字体和字形）在每次修改后稍等片刻，保存在 `localStorage` 的一个带版本号的键 `none-curve:session` 下（`src/state/persist.ts`）。第一次绘制恢复的设置时会设置 `none-curve:restoring`，所以如果上一次访问在这时崩溃了，下一次会从默认设置开始。浏览器端的小便利（选中的标签页、面板分栏、Show all explanations）各用自己的 `none-curve:` 键。
- 不保存的：Drive letters、音频来源、实时值、对话框、主题，以及缩放和平移。
- 保存的会话在启动时读取一次，逐项对照默认值检查：类型不对或选项未知时用默认值，数值超出范围时限制到范围之内，未知的键会被丢弃，所以损坏的或旧的记录绝不会让应用出错。新设置需要在 `initialState` 里有默认值，并在 `persist.ts` 里写明范围或可选值（`RANGES`、`CHOICES`、`ENUMS`）；如果它是 `SLIDER_RANGES` 里的滑块，则直接使用那一项。
- 重命名或移动已保存的设置，或重命名 Sound 的特征或目标 id，都需要迁移：提高 `SESSION_VERSION`，并在 `MIGRATIONS` 里加一步，把旧名称改成新名称，这样以前的会话能保留它们的值（从没有版本号的会话迁移的那一步，会改第 9 阶段的效果名和合并后的 Sound 特征名）。不要把旧名称挪作他用。旧版应用读到新版本的会话时，能读多少就读多少。
- 每次访问 `localStorage` 都要用 `try`/`catch` 包起来：存储可能被禁用或已满，这时应用照常工作，只是不保存。
- 撤销（`src/state/history.ts`）：修改在发生的地方记录（App 的 `edit` 和文字的设置函数、映射存储），从不在 reducer 里记录，reducer 保持纯函数。设置通过 `edit` 修改；画布视图、字形选择、导出设置和导入使用 `dispatch`，不能撤销。记录每个修改时都带一个说明改了什么的键（`edit` 会根据改变的设置自动得出），这样一次滑块拖动是一步；由多个更新组成的修改（预设的 Load、Freeze、一个目标连同它打开的设置）要包在 `undoHistory.transaction` 里。Sound 的实时帧从不 dispatch，所以从不进入历史。
