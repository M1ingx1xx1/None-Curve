# 声音计划

[English](SOUND_PLAN.md) · **中文**

**状态：** 第 1 阶段（声音来源、特征、电平表）和第 2 阶段（连续映射、实时调度、实时值标记、闪烁限制、Freeze）已完成  
**范围：** 在 **Geometry** 和 **Experimental** 旁边新增 **Sound** 标签页。实时声音（本地音频文件或麦克风）驱动两个标签页里已有的参数，让字母随音乐而动：锚点踩着节拍跳动，声音变响时轮廓被揉皱，低音响起时花瓣张开。

## 1. 目标

- 声音**只驱动已有的参数**，包括 Geometry 标签页（Curve flattening、Random anchors、Squaring、Anchors、Grid & angles、Distortion）和 Experimental 标签页（Noise、Ripple、Curl、Wind、Seed）。不新增任何变形操作。
- 两种驱动方式：
  - **连续：** 响度这样的特征让滑块上下移动。
  - **事件：** 节拍让某个值跳变，例如换一个新种子（锚点跳到新位置），或换到下一档角度。
- 实时运行，帧率随设置的计算量自动调整。
- 音频只留在浏览器里：在本地解码和分析，从不上传。
- 关闭 Sound 后，滑块的值完全恢复原样。

这取代了之前"由声音驱动的雕刻字形"方向（PRD 第 11 节）。那个方向计划了新的雕刻操作、时间轴、把音频分布到一段文字的各个字母上，以及配方导出；这些都不再做。

## 2. 最高规则：没有曲线

声音只改变参数值，而且只在每个滑块自己的范围内改变。所以屏幕上的每一帧都是手动拖滑块也能得到的结果，由同一条流程计算：只保留直边，像其他结果一样经过检查，并且可以导出。各帧算好一帧就显示一帧。帧与帧之间不做补间或变形过渡，因为那会凭空造出流程从未生成过的中间轮廓。

## 3. 声音来源

- **Off**（默认）。
- **File：** 浏览器能解码的任何音频文件（WAV、MP3、AAC、OGG、FLAC，取决于浏览器）。有播放、暂停、循环和进度滑块，并通过扬声器播放。
- **Microphone：** 只有用户按下 **Start listening**、浏览器请求权限之后才会开始；选中 **Microphone** 只会显示这个按钮。不回放，所以不会产生回授。Stop listening、切换来源和关闭标签页都会释放麦克风，使用期间会显示指示标记。
- 无效、空白、静音和不支持的输入各有各的提示信息。

## 4. 音频特征

每个动画帧都从 Web Audio 的 `AnalyserNode` 计算特征：44.1 和 48 kHz 下是 2048 点 FFT（88.2 和 96 kHz 下加倍，使分析窗口保持约 43 ms），响度用时域采样计算。分析器前面有一个 20 Hz 高通滤波器，去掉被测量信号里的直流偏移。

| 特征 | 定义 | 归一化到 0–1 |
|---|---|---|
| **Level**（响度） | 短时 RMS（去掉直流偏移），单位 dB | −60 dB → 0，0 dB → 1，按 **Sensitivity** 平移 |
| **Low**（低频） | 20–250 Hz 的能量 | 相对于一个缓慢自适应的滑动最大值 |
| **Mid**（中频） | 250–2000 Hz 的能量 | 同上 |
| **High**（高频） | 2000 Hz 到奈奎斯特频率的能量 | 同上 |
| **Brightness**（亮度） | 20 Hz 到 20 kHz 的频谱质心，按对数频率刻度 | 100 Hz → 0，8 kHz → 1 |
| **Beat**（节拍，事件） | 起音：频谱通量超过自适应阈值（最近一秒的中位数 × 一个系数，加一个下限，并且至少是上一次起音通量衰减后的一半，所以一次敲击自己的尾巴不会再次触发），两次至少相隔 100 ms。低频版本（**Kick**）对突然出现的低音起反应，主要是底鼓；每次 Kick 也算作一次 Beat。 | — |

第 4 阶段增加 **Pitch**（音高；用 YIN 计算，附带置信度；无声或置信度低的帧保持上一个值，而不是跳变）和 **Balance**（左右声道平衡，仅限文件）。

- **Smoothing（平滑）：** 每个连续特征都以快速的起音（10 ms）和较慢的释放（默认 150 ms，由 **Smoothing** 设置）跟随声音，所以字母立即响应，但不会闪烁。
- **静音门限：** 低于静音阈值时，连续特征降到 0，也不会触发节拍。即使另一个频带很响，自身能量低于静音阈值的频带也读作 0。
- **Sensitivity** 也会缩放起音通量所比较的幅度，即 ln(1 + 1000 g m)，其中 g = 10^(Sensitivity / 20)，所以它同样作用于 Beat 和 Kick。这与最初规格里的公式 ln(1 + 1000 m) 不同：按那个公式，Sensitivity 帮不了小声来源的起音检测。
- 起音每秒最多判断约 60 次，所以在 120 Hz 及更高刷新率的屏幕上，阈值的含义也相同。
- 处理分母为零的情况，并截断离群值。

## 5. 映射

一个映射把一个特征连接到一个目标参数。Sound 标签页最多容纳 8 个映射，每个都有开关。

- **连续映射**（Level、Low、Mid、High、Brightness、Pitch、Balance → 任意滑块）：
  - 实时位置 = 滑块位置 + **Depth** × 特征，截断到滑块两端，再取整到滑块的档位。位置沿滑块的绘制方向计算（0–1），所以普通滑块相当于 滑块值 + Depth × 特征 × 滑块的全部范围，而对数刻度的滑块（如 Tolerance）沿滑道均匀移动。
  - Depth 从 −100% 到 100%。Depth 为负时，声音越响，值越小。
- **事件映射**（Beat 或 Kick → 目标），分三种：
  - **Jump（跳变）：** 每个节拍让种子前进一个，所以锚点、翻折或阵风跳到新位置。
  - **Step（步进）：** 只有几个可选值的参数在每个节拍换到下一个，例如 Allowed directions（角度步长）15° → 30° → 45° → 90°、Sides 或 Rings。
  - **Kick（冲击）：** 值在节拍处按 Depth 跃起，再在释放时间内回落到滑块值。效果是一次脉冲，而不是永久改变。
- **同一目标上的多个映射：** 它们的作用相加，再截断总和。每行都写明自己的目标，被驱动滑块上的标记显示合计后的实时值。
- **基准值保持不变：**
  - 滑块保留自己的值，Sound 实时运行时滑块不动；每个被驱动的滑块上有一条细标记显示实时值。
  - Depth 为 0 或映射关闭时，得到的就是滑块值本身。
  - 映射到已关闭的步骤或效果（Random anchors、任一 Experimental 效果）时不起作用，该行会注明。

## 6. 目标

**Geometry 标签页**，"锚点跳动"就在这里：

| 目标 | 建议的驱动 | 看到的效果 |
|---|---|---|
| Distortion **Seed** | Beat → Jump | 每个节拍所有锚点都跳到新位置 |
| Distortion · **Noise amplitude** | Level，或 Beat → Kick | 声音响时锚点抖得更厉害，或在节拍处弹出再回稳 |
| Distortion · **Noise frequency** | Brightness | 声音越亮，边缘越细碎、越抖 |
| Random anchors **Seed** | Beat → Jump | 每个节拍都在新位置重新采样锚点 |
| Random anchors **Randomness** | Level | 响时锚点散开；静时均匀排列 |
| Random anchors **Density** | Low，按档 | 低音时锚点更少、更粗大 |
| Curve flattening · **Tolerance** | Level | 响亮的段落更粗糙、更像多边形 |
| **Squaring** amount | Mid | 碗形随人声变方 |
| Anchors · **Anchor spacing** / **Anchor reduction** | High / Level | 锚点变密或减少 |
| **Grid** size | Low，按档 | 低音时吸附到更粗的网格 |
| Grid & angles · **Allowed directions**（角度步长） | Beat → Step | 边依次锁定到 15°、30°、45°、90° |

以下也是目标，但没有建议的驱动方式：Curve flattening 的 Segments per curve 和 Corner angle，以及 Distortion 的 Normal bias。完整列表按面板顺序见 `src/sound/mapping.ts` 中的 `TARGETS`（README 的“目标”一节）。各个种子和 Allowed directions 在第 3 阶段随事件映射成为目标。

**Experimental 标签页**：Noise 的 Amount / Facet size / Turn；Ripple 的 Amount / Wavelength / Sides / Center X / Center Y / Fade / Petals；Curl 的 Amount / Rings / Sides；Wind 的 Direction / Strength / Gust size / Gustiness；以及共用的 **Seed**（Beat → Jump，第 3 阶段）。

开关（Use noise、Pin top and bottom 等）和 Curve flattening 的 Mode 不是目标：声音从不打开或关闭任何步骤。

## 7. 预设

预设是填好映射的起点：

- **Anchor jump：** Beat → Distortion Seed（Jump）；Level → Distortion · Noise amplitude（Depth 30%）。
- **Resample：** Beat → Random anchors Seed（Jump）；Level → Randomness。
- **Bass bloom：** Kick → Ripple Amount（Kick）；Low → Ripple Petals。
- **Shiver：** High → Noise Amount；Brightness → Noise Turn。
- **Whirl：** Level → Curl Amount；Beat → Experimental Seed（Jump）。
- **Grid pulse：** Low → Grid size（按档）；Beat → Allowed directions（Step）。

## 8. 架构与性能

- **新代码放在 `src/sound/`：**
  - `types.ts`：共用的类型、上下限和静音特征帧。
  - `engine.ts`：Web Audio 音频图及其来源。
  - `useSound.ts`：访问音频引擎及其帧的 React hook。
  - `features.ts`：从频谱和采样中提取特征（无需音频即可测试）。
  - `mapping.ts`：目标列表，以及 滑块值 + 特征 + 映射 → 实时参数（`modulate`，纯函数）。
  - `mappingStore.ts`：一个带 hook 的小型存储，保存映射和 Drive letters（驱动字母）开关；页面打开期间跟随 `prefers-reduced-motion` 的变化。
  - `live.ts`：帧调度（`LiveScheduler`，可通过注入依赖测试）、闪烁限制（`FlashLimiter`）、提供实时参数、实时标记位置和实时状态的 hook，以及 Freeze。标记组件本身是 `src/components/LiveMarker.tsx`。
- **流程不变；实时请求带 `live` 标记。** 实时参数作为带 `live` 标记的计算请求发给几何 Worker；Worker 本来就会在字形之间丢弃已被取代的请求。这个标记只让实时结果存入单独的实时缓存（见下文），几何的计算方式不变。页面会先留住一个实时帧的结果，直到它的请求完成，所以每一帧都完整地显示（第 2 节）。
- **跟随实时参数的：** 字母、画布上画出的吸附网格和状态栏的描述。保持滑块值的：滑块、导出，以及 Typography 标签页里的 Fit text 和 Free（和导出一样，它们测量滑块值下的字母）。
- **自适应帧率：**
  - 特征每个动画帧更新一次。
  - 同一时间最多只有一个几何请求在处理；上一个完成后才发下一个，所以帧率随计算量变化。
  - 帧率上限为 30 fps，Sound 标签页会显示当前帧率。
  - 低于约 8 fps 时，会建议用更轻的设置或更短的文字。
- **实时值取整：** 每个值都取整到所在滑块的档位（种子本来就是整数），这样重复的值会命中几何缓存，而不必重新计算。
- **单独的实时缓存：** 实时帧使用自己的小缓存（约 600 条），所以一首歌不会把正常编辑时缓存的结果挤掉。
- **范围：** 和现在一样，只计算文字里的字形和当前选中的字形。
- **空闲时的音频：** 没有播放也没有收音 2 秒后，音频上下文会暂停，Play 和 Start listening 会让它恢复。注意：在 Safari 中，之后用媒体键重新开始的播放可能没有声音，直到用户按下 Play。
- **实测耗时：**
  - 只有 Geometry 时，每个字形约 0.1 ms。
  - 所有 Experimental 效果同时翻折时，每个字形最多约 20 ms，对较长的文字来说太重，无法实时使用。
  - 实时帧（在 worker 中测量；Node、Arial、默认文字的 24 个不同字形，特征扫动时取 30 帧）：Level → Distortion 的 Noise amplitude 约 2.6 ms，Level → Noise Amount 7.4 ms，Low → Ripple Petals 6.2 ms，三者同时 12.3 ms，都达到 30 fps 上限。Noise、Ripple、Curl、Wind 全开时每帧约 41 ms（约 24 fps）。重复的值命中缓存，不到 0.1 ms；页面上排布字形和画板每次渲染约 0.3 ms。
  - 页面上，Geometry 和 Experimental 标签页的控件以及字形列表会跳过实时帧，除非它们自己的统计数字变了（`React.memo`）：在生产构建中（Arial、默认文字、驱动 Noise amplitude），每个实时帧的页面 JavaScript 从约 5.3 ms 降到约 4.5 ms。
  - 尚未测量：每帧把结果复制到页面并重绘 SVG，这是主线程上的主要风险。在第 3 阶段于浏览器中测量，只有它限制帧率时才把实时视图改为 canvas 绘制。

## 9. 冻结、导出与可重复性

- **Freeze** 把屏幕上的实时值写入滑块，并让声音暂停（暂停文件或停止收音），所以冻结下来的样子会留在屏幕上。它就成了普通的、可重复的设置；按 Play 或 Start listening 可以继续。只要声音在驱动字母，它就可用（不会随节拍闪烁）；如果按下时字母正好和滑块一致（例如两次鼓点之间），它只会暂停声音。
- 导出（SVG、PNG、OTF）始终使用滑块值，从不使用实时音频。Sound 实时运行时，Export 对话框会说明这一点，并指向 Freeze。
- 实时输出取决于时机，不可重复；冻结后的设置可以重复。
- 视频录制以后再做。

## 10. 安全与无障碍

- **闪烁：** 快速的摆动可能造成闪烁（WCAG 的三次闪烁阈值）。
  - 连续映射（已完成）：被驱动的滑块在任意一秒内最多折返 6 次（3 次闪烁），每次折返至少是滑道的 10%。折返按显示出来的滑块位置（取整到档位之后）在 1.25 秒内计数，所以稍晚到达屏幕的帧也守这个限制。再多的折返会让滑块保持上一个值，直到这段时间过去；保持的值是滑块片刻之前给出的值（第 2 节），标记和 Freeze 也使用它。
  - 事件映射（第 3 阶段）：由节拍驱动的跳变默认每秒最多 3 次。
- **减少动态效果：** 开启 `prefers-reduced-motion` 时，**Drive letters** 默认关闭（电平表照常工作），Sound 标签页会说明原因；页面打开期间才开启减少动态效果时，它也会自动关闭。
- **麦克风：** 只在用户明确点击后启用，显示可见的指示标记，停止时释放。
- **不联网：** 什么都不上传，音频不会离开浏览器。

## 11. 界面

所有标签都用英文，尽量简短，说明收在 ⓘ 按钮里。

- 第三个标签页 **Sound**，在 Geometry 和 Experimental 旁边。和现在一样，浏览器会记住选中的标签页。
- **Source（来源）：** Off / File / Microphone。File 有 Choose file、播放/暂停、Loop、进度和文件名。Microphone 有 Start listening / Stop listening 和使用中的指示标记。
- **电平表：**
  - Level、Low、Mid、High 和 Brightness 的条形表。
  - Beat 和 Kick 两盏指示灯，开启减少动态效果时也保留。
- **Sensitivity**（输入增益）和 **Smoothing**（释放时间）。
- **映射：**
  - 每行有 Feature、Target（分组：Geometry / Experimental）、Depth 和开关；事件目标还会显示类型（Jump / Step / Kick）。行内控件的名称带行号（“Remove mapping 2”）；目标当前不起作用时，行下方的说明也是 Target 的描述。
  - **Add mapping**、**Presets**（第 3 阶段），以及每行一个删除按钮。删除一行后，键盘焦点移到下一行的删除按钮（没有时移到上一行的，都没有时移到 Add mapping）。
- **Freeze** 和 **Reset sound**。
- **状态栏：** Sound 驱动字母时显示 "Live · N fps"。
- **被驱动的滑块：** 显示实时值标记。

## 12. 验证

- **特征：** 用合成信号测试：
  - 静音得到 0，没有节拍。
  - 100 Hz 的纯音读作 Low、偏暗；5 kHz 的纯音读作 High、偏亮。
  - 120 BPM 的咔嗒声每秒约 2 个节拍。
  - 白噪声读作偏亮。
  - 响度随振幅升高。
- **调制：** Depth 为 0 或映射关闭时得到滑块值；值会被截断；多个作用相加；已关闭组里的目标不起作用；Kick 在释放时间内回落；Step 循环切换；频率限制有效；每秒 4 次的底鼓在满 Depth 下，任意一秒内最多让滑块折返 6 次，每个值都落在滑块的档位上。
- **没有曲线与有效性：** 每个实时帧都是一组普通参数，已被现有审计覆盖。此外，记录一段测试音轨经过的参数组，在 Arial、New York 和 Georgia 上跑有效性审计和像曲线的段落审计。
- **性能：** 每个预设在短文字和长文字上、以及在重度设置下的帧率。
- **浏览器实测：** 用本地测试文件和麦克风测试，不下载任何东西。检查 Off 是否让滑块完全恢复，并检查先 Freeze 再 Export。
- **文档：** README、用户指南和 PRD，中英文分开写。

## 13. 阶段

| 阶段 | 内容 |
|---|---|
| 1 | Sound 标签页；音频引擎（File、Microphone）；特征 Level、Low、Mid、High、Brightness、Beat、Kick；电平表 |
| 2 | 调制层、连续目标的映射、带独立缓存的自适应实时调度、滑块上的实时值标记、连续映射的闪烁限制、Freeze |
| 3 | 事件映射（Jump、Step、Kick）及其频率限制、预设；实时 SVG 重绘测量 |
| 4 | Pitch 和 Balance |
| 以后 | 视频录制 |

每个阶段都以第 12 节的验证收尾，并单独交付。
