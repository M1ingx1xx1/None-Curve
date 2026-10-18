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

- 测试放在 `tests/` 下，按领域分目录（`tests/geometry`、`tests/export`、`tests/font`、`tests/sound`、`tests/specimen`、`tests/state`、`tests/worker`，以及测试 `scripts/` 中 Jira 同步的 `tests/scripts`）；慢的测试放在 `tests/slow`。
- `npm test` 运行快速测试（约 15 秒）。`npm run test:slow` 运行慢速测试（完整的 42 秒 Sound 测试音轨，以及两种测试字体的全部字形；约 5 分钟），只有点名要求时才运行。
- `npm run build` 也会对测试和脚本做类型检查（`tsconfig.test.json`）。
- 向 `develop` 提交 pull request 之前先运行 `npm test`。CI 在每个提交到 `develop` 的 pull request 和每次推送到 `develop` 时运行 `npm test` 和 `npm run build`；Pages 部署也会先运行 `npm test` 再构建。
- 测试字体只用开源授权的字体（OFL：STIX Two Text 和 Roboto），每个字体旁边都放着它的 `OFL-*.txt`，位于 `tests/fixtures/fonts`。不要加入不允许再分发的字体。
- 发现 `src/` 里 bug 的测试要保留下来，写成 `it.skip`，并加一条 `BUG:` 注释说明问题，直到 bug 修好为止。
- 生成的文件不提交。Sound 测试音轨由 `npm run test-track`（来自 `scripts/test-track.ts`）渲染为 `test-audio/sound-test.wav`，git 会忽略它；有一个测试检查它每次渲染出的采样都相同。
- 需要测试里跑不了的浏览器 API（MediaRecorder、画布捕获、Web Audio、标签页是否可见）的代码，要拆成纯模块和一个控制器：控制器通过注入的依赖拿到这些 API，上面再加一层很薄的页面单例。视频录制就是范例：`RecordingController`（`src/export/recorder.ts`）把时钟和计时器、声音引擎、画布、MediaRecorder、标签页可见性以及 `save` 作为 `RecorderDeps` 接收，`tests/export/recorder.test.ts` 用它们的假实现跑完每一次录制，完全不碰 DOM。画布绘制接收一个绘制器（`src/export/drawArtboard.ts`），所以一个记录调用的假绘制器就能拿它和 SVG 导出对照。
- 绝不真的下载文件。测试传入假的 `save`（或其他注入的接收方），从不调用 `downloadFile`。要导出或录制的浏览器检查，先把 `HTMLAnchorElement.prototype.click` 换成只收集链接、不打开它的函数，并让 `URL.revokeObjectURL` 什么都不做，这样收集到的 blob 仍然能读。
- `tests/sound/neutral.test.ts` 把 Response 设置为中性值（Strength 100%，Motion contrast、Pitch reactive 和 Melody tracking 为 0）时的 Sound 固定为提交 4a54e5d（这些设置出现之前）时的输出：除分析器的读数外都是精确值，读数按 10 位有效数字计算哈希（见下一条）。实时调度器的哈希不包含起始设置会打开 Thorn 的预设（Flare）：Thorn 轮次有意改变了它们的实时帧，Flare 改由 `tests/sound/turns.test.ts` 测试。永远不要修改这个测试，包括其中的哈希值：它失败时，说明某处改动影响到了中性路径，应该修正那处改动。例外只有两种：从 4a54e5d 的导出重新取得锁定值（读数，以及不含 Flare 的调度器 `32a8121b`，都是这样取的）；以及一处会改变所有实时值的有意改动（NOCUR-60 中 Crumple 去掉 Detail，NOCUR-63 中滑块档位改细），这时可以从新代码取锁定值，但必须先证明只撤销这一处改动就能得到原来的哈希，并在哈希旁边的注释里写明。
- 来自 `Math` 函数（`log`、`exp`、`sin` 等）的数值要先取整再计算哈希，不要用精确值。V8 的 x64 版和 arm64 版在最后一位上可能不同（`Math.log2` 和 `Math.log10` 就是这样），而 CI 运行在 Linux x64 上，Apple 芯片的 Mac 是 arm64，所以在一边锁定的精确哈希到另一边会失败。`neutral.test.ts` 把这类数值取到 10 位有效数字：两边结果一致，而千万分之一的改动仍能被发现。锁定哈希前要在两边都核对过，例如在 Rosetta 下运行官方的 x64 版 Node。
- 按屏幕显示的样子计算闪烁。`tests/sound/flash.test.ts` 中的 `lettersOnScreen` 把档位之间的移动从最近 250 ms 内显示过的任何一帧算起（`SPREAD_MS`，与 `LIVE_LIMITS.switchSpanMs` 是同一个时长），一帧里的变化只算一次；这样分几帧到达屏幕的一次变化只算一次，而摊薄在几帧里的变化也不会漏掉。
- 在浏览器中检查 Sound 时让标签页保持可见。声音在 `requestAnimationFrame` 上读取，所以标签页被隐藏或被遮住时（包括隐藏起来的浏览器面板）没有帧，或只有一阵一阵的帧，字母也就不再跟随声音；"Live · N fps" 显示的是几何计算的速率，而不是读取声音的频率，所以看不出这一点。

## 分支、Pull Request 与 Jira

- 工作在从 `develop` 拉出的 `feature/NOCUR-<编号>-<简短名称>` 分支上进行，分支名带上所做的 Jira issue（NOCUR 是本项目的 key），通过 pull request 合并进 `develop`。`main` 是发布分支：从 `develop` 到 `main` 的 pull request 就是一次发布，每次推送 `main` 都会部署 Pages。
- `.github/workflows/jira.yml`（`scripts/jira-pr-sync.ts`）会推进 pull request 提到的 issue：pull request 处于打开状态时（打开、重新打开、有新的推送或被编辑时）转为 In Progress，合并时转为 Done。pull request 通过分支名、标题，或正文中以 `Jira:` 开头的一行（`Jira: NOCUR-57, NOCUR-58`）开头的那些 key 提到 issue。这一行到第一个不是 key 的词为止，所以 `Jira: NOCUR-60 (split from NOCUR-41)` 只提到 NOCUR-60；正文其他地方出现的 key（例如顺带提到的父任务）不算。
- issue 只往前走。打开时只推进还在 To Do 的 issue，已经在 In Progress、In Review 或 Done 的保持原样；合并时推进所有还没完成的 issue；关闭但未合并的 pull request 什么都不改。issue 在它的 pull request 合并进 `develop` 时就算完成，而不是发布时；发布用的 pull request 不提任何 issue，也不改动任何 issue。
- 打开 pull request 时就把 key 写进分支名或标题；之后才加上的 key 会在下一次推送或编辑时推进对应的 issue。与目标分支有冲突的 pull request 不会触发任何 workflow，所以它的 issue 要等冲突解决并推送后才会推进。
- issue 只通过 pull request 推进。手动只更新 issue 的描述；每次发布后，把发布日期和发布用的 pull request 记到发布记录 NOCUR-28 里。
- workflow 读取三个仓库 secret：`JIRA_BASE_URL`（`https://<站点>.atlassian.net`）、`JIRA_EMAIL`，以及该账号的 Atlassian API token `JIRA_API_TOKEN`（状态变更记在这个账号名下）。没有配置时只给警告，检查不会因此失败；GitHub 不会把 secret 交给来自 fork 的 pull request，所以这类 pull request 的 issue 要手动推进。脚本先向 Jira 核对账号：token 过期或被吊销时，Jira 会当作没有人登录，每个 issue 看起来都不存在；核对之后检查会直接失败，解决办法是把新的 token 填进 `JIRA_API_TOKEN`，再重跑失败的 job。Jira 拒绝请求或无法连接、`JIRA_BASE_URL` 不是 `https` 地址时，检查同样失败；Jira 不认识的 key 只给警告。日志中会隐去站点地址。
- 脚本从事件文件读取 pull request，从不把文字放进 shell 命令，所以标题或正文无法执行任何东西。

## 几何计算与 Worker

- 字形几何只在几何 Worker 里计算（`src/geometry/geometry.worker.ts`，逻辑在 `workerCore.ts`），从不在页面上计算。画布、文字预览、Sound 的实时帧以及 SVG 和 PNG 导出，都通过页面端的客户端（`src/state/geometryClient.ts`）请求：导出用 `ensure()`，实时帧用 `prefetchJobs()`。不要加主线程的后备方案；Worker 无法运行时，画布会说明并请用户刷新页面。
- 客户端运行一组几何 Worker（`poolSize`：逻辑核数减一，2 到 4 个；`workers` 选项可以指定数量，测试传入 `workers: 1` 或注入 `createWorker`，每个 Worker 调用它一次）。调用方发出的一个请求仍是一个请求：客户端按字形把它分给各个 Worker（同一字形的所有参数组给同一个 Worker，每一份保持请求的顺序，用同一个请求 id），所有部分都结束后请求才结束。调用方看不到这些 Worker。一个字形优先回到之前算过它的 Worker，除非那个 Worker 会因此超出份额；份额按 Worker 在每条 `results` 消息里报告的耗时（`times`；结果直接来自它的缓存时为 null，这种耗时说明不了字形的开销）加权。新请求再次要某个 Worker 正在算的字形时，这个字形留给它。每个 Worker 只用字形缓存上限的 1/N（`font` 消息带有 `workers`）。卡住或出错的 Worker 单独重启，只结束它自己那一份。
- 协议（`src/geometry/protocol.ts`）：每个计算请求都有一个 id，并且在任何路径上（包括 Worker 没有这个字体时）都以恰好一个回答结束：`done`（如果被更新的请求或 `cancel` 在字形之间停下，则带 `stopped`）或 `failed`（带原因）。一个请求带一个或多个任务（一个参数键和它的字形），按顺序执行；每条 `results` 消息只含一个任务的键。Worker 在每个字形之前发送 `glyph`：这是页面的心跳，也写明参数键和出问题时该怪的字形。新增的消息类型也要遵守这些规则。
- 一个实时帧就是一个请求。帧里的字母可能反应幅度不同（共享值，以及安静和强烈两个档位），打开 Thorn 时还会按轮次组显示不同的 Thorn 设置（`src/sound/types.ts` 中的 `THORN_TURNS`），所以字母最多显示 15 组参数（3 个档位 × 5 个轮次组），再加上每帧总会请求的共享值，最多 16 组。`prefetchJobs()` 把它们都作为同一个请求的任务发出，共享值排在最前；全部到齐后才提交这一帧。每个任务只列出它那组参数需要的字形：共享参数覆盖画面上的每个字形，有 Thorn 轮次时只覆盖显示它的字母的字形和选中的字形（`FrameJob.within`、`shownGlyphs`）；其他每组参数只列出自己字母的字形。不要把一帧的几组参数拆成几个请求发送：较新的请求会取代正在处理的请求。实时结果与编辑时的结果分开保存，按最近最少使用的顺序淘汰：保留最近四个实时请求中最多组数的两倍，至少 6 组，最多 `LIVE_KEPT_KEYS`（32）组，所以下一帧计算时，画面上那一帧的各组参数仍然保留。
- 客户端：Worker 在一个字形上 60 秒没有消息时，这个字形被标为失败（"Took longer than 60 s; try lighter settings"），Worker 重启并重新发送字体；重启次数按整组 Worker 合计，60 秒内超过 3 次，就停掉所有 Worker，几何计算停止，直到换下一个字体，画布会说明原因（启动不了的 Worker 退出这组 Worker；一个都不剩时几何计算也停止）。新的设置会替换卡在一个新请求已不需要的字形上 750 毫秒以上的 Worker（整组 Worker 每 2 秒最多替换一个，实时帧除外）。要让重度设置变快，应像 Experimental 的顶点预算那样在流程内部解决（EXPERIMENTAL_PLAN 第 4.10 节），而不是放宽这些限制。
- 字体导出每次构建都在自己的 Worker 里运行（`src/export/fontExport.worker.ts`）。Cancel 会立即终止它，一分钟没有进度时也会终止。只有这个 Worker 无法启动时，构建才在页面上运行。
- 不用浏览器测试 Worker 的逻辑和客户端：`tests/worker` 用假的 `post` 运行 `workerCore`，用假 Worker 和假计时器测试客户端。

## 滑块范围

- 每个 Geometry 和 Experimental 滑块的范围和档位只写一次，写在 `src/state/sliderScales.ts` 里：`SLIDER_RANGES`，按滑块的 Sound 目标 id 索引（`"group.key"`、`"experimental.effect.key"`）；对数刻度的 Tolerance 滑块用 `TOLERANCE`。
- 面板把这一项展开到它的 range 输入上（或在 `RangeField` 上写明目标），Sound（`src/sound/mapping.ts`）和保存会话的检查也读同一项，所以实时值和恢复的值总是滑块自己能给出的值。
- 每个滑块都有一个数字框（`SliderNumber`，基于 `NumberField`），读的也是同一项：它按标签的单位显示数值（以百分比显示的比例用 `scale` 100），输入的值先限制在范围内、取整到档位，再提交。Tolerance 和 Reach 的数字框直接输入值本身（Tolerance 精确到 0.01 个单位，再由 `roundTolerance` 取整；Reach 为画布的百分比，精确到 0.01%）。
- 不要在别处再写滑块的最小值、最大值或档位；要改范围，就改这一项。新滑块先在这里加一项。`sliderRange(id)` 遇到没有的 id 会抛错，所以拼写错误会立刻暴露。
- Sound 标签页自己的滑块也遵守同样的规则，范围来自 `src/sound/types.ts`：Sensitivity 和 Release 来自 `SOUND_LIMITS`（`minSensitivity`、`maxSensitivity`、`sensitivityStep`；`minReleaseMs`、`maxReleaseMs`、`releaseStepMs`），Strength、Motion contrast、Pitch reactive 和 Melody tracking 来自 `RESPONSE_LIMITS`。存储中这四个值是小数（Strength 1 即 100%），面板按同一项以百分比显示；`clampResponse` 和保存会话的检查（`persist.ts` 中的 `SOUND_RANGES`）也读这些项。
- 视频的限制只写一次，写在 `VIDEO_LIMITS`（`src/export/videoFormat.ts`）里：最长边和面积、10 分钟上限、码率范围、音频延迟的范围，以及录制器的各个时间。Record 的选项和录制器都从那里读取。

## 保存设置与撤销

- 会话（设置、画布视图按钮、文字、预览的外观、导出精度、Sound 映射、Sound 标签页的 Response 组（Sensitivity、Strength、Motion contrast、Release、Pitch reactive、Melody tracking），以及打开的字体和字形）在每次修改后稍等片刻，保存在 `localStorage` 的一个带版本号的键 `none-curve:session` 下（`src/state/persist.ts`）。第一次绘制恢复的设置时会设置 `none-curve:restoring`，所以如果上一次访问在这时崩溃了，下一次会从默认设置开始。浏览器端的小便利（选中的标签页、面板分栏、Show all explanations）各用自己的 `none-curve:` 键。
- 不保存的：Drive letters、音频来源、录制选项（Format、Length、Include audio、Use the preview look）、实时值、对话框、主题，以及缩放和平移。Sensitivity、Release 和四个响应值会保存。
- 保存的会话在启动时读取一次，逐项对照默认值检查：类型不对或选项未知时用默认值，数值超出范围时限制到范围之内，未知的键会被丢弃，所以损坏的或旧的记录绝不会让应用出错。新设置需要在 `initialState` 里有默认值，并在 `persist.ts` 里写明范围或可选值（`RANGES`、`CHOICES`、`ENUMS`）；如果它是 `SLIDER_RANGES` 里的滑块，则直接使用那一项。Sound 的设置是一个可选的 `sound` 块，由 `readSound` 对照 `SOUND_LIMITS` 和 `RESPONSE_LIMITS` 读取。
- 新增一个设置，或新增一个以前的会话没有的块，不需要迁移：缺少的值按默认值读取。`sound` 块就是这样加入的，会话版本仍是 2。
- 重命名或移动已保存的设置，或重命名 Sound 的特征或目标 id，都需要迁移：提高 `SESSION_VERSION`，并在 `MIGRATIONS` 里加一步，把旧名称改成新名称，这样以前的会话能保留它们的值（从没有版本号的会话迁移的那一步，会改第 9 阶段的效果名和合并后的 Sound 特征名）。不要把旧名称挪作他用。旧版应用读到新版本的会话时，能读多少就读多少。
- 每次访问 `localStorage` 都要用 `try`/`catch` 包起来：存储可能被禁用或已满，这时应用照常工作，只是不保存。
- 撤销（`src/state/history.ts`）：修改在发生的地方记录（App 的 `edit` 和文字的设置函数、映射存储，以及 Response 组：它先记录 Sensitivity 和 Release，再把它们设到引擎上），从不在 reducer 里记录，reducer 保持纯函数。设置通过 `edit` 修改；画布视图、字形选择、导出设置和导入使用 `dispatch`，不能撤销。记录每个修改时都带一个说明改了什么的键（`edit` 会根据改变的设置自动得出），这样一次滑块拖动是一步；由多个更新组成的修改（预设的 Load、Freeze、一个目标连同它打开的设置、Reset sound）要包在 `undoHistory.transaction` 里。Reset all（`src/state/reset.ts`）不算一步：`resetHistory` 通过 `UndoHistory.startOver` 把历史所管的部分恢复为 `START_SNAPSHOT`，同时清空历史，所以它不能撤销；reducer 的 `resetAll` 动作返回 `initialState`，`src/App.tsx` 中的 `resetAll` 重置历史之外的部分。Sound 的实时帧从不 dispatch，所以从不进入历史；录制选项和录制本身也不进入历史。
