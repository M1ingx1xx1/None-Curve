# 声音计划

[English](SOUND_PLAN.md) · **中文**

**状态：** 第 1 阶段（声音来源、特征、电平表）和第 2 阶段（连续映射、实时调度、实时值标记、闪烁限制、Freeze）已完成。第 3 阶段部分完成（会跳变的种子、10 个特征中的 Pitch 和立体声 Pan、紧凑的电平表、自动打开所需设置的目标、预设，以及重做后的 Experimental 效果的目标和预设）；Step 映射和实时 SVG 重绘测量尚待完成。此后又加入了：Beat 的能量门（第 4 节）、滑块和种子共用一个闪烁预算（第 10 节）、映射在两次访问之间保存并可撤销（第 5 节），以及自动测试（第 12 节）  
**范围：** 在 **Geometry** 和 **Experimental** 旁边新增 **Sound** 标签页。实时声音（本地音频文件或麦克风）驱动两个标签页里已有的参数，让字母随音乐而动：锚点踩着节拍跳动，声音变响时轮廓被揉皱，低音响起时花瓣张开。

## 1. 目标

- 声音**只驱动已有的参数**，包括 Geometry 标签页（Curve flattening、Random anchors、Squaring、Anchors、Grid & angles、Distortion）和 Experimental 标签页（Crumple、Ripple、Whorl、Slipstream、Thorn、Seed）。不新增任何变形操作。
- 两种驱动方式：
  - **连续：** 响度这样的特征让滑块上下移动。
  - **跳变：** 种子前进，于是锚点跳到新位置：每个节拍跳一次，或者某个特征的读数越高跳得越频繁。节拍也可以让一个值换到下一个可选值，例如下一档角度（尚待完成）。
- 实时运行，帧率随设置的计算量自动调整。
- 音频只留在浏览器里：在本地解码和分析，从不上传。
- 关闭 Sound 后，滑块的值完全恢复原样。

这取代了之前"由声音驱动的雕刻字形"方向（PRD 第 11 节）。那个方向计划了新的雕刻操作、时间轴、把音频分布到一段文字的各个字母上，以及配方导出；这些都不再做。

## 2. 最高规则：没有曲线

声音只改变参数值，而且只在每个滑块自己的范围内改变，这个范围读自构建该滑块的同一张表（第 8 节；种子：在其输入框范围内的整数）。所以屏幕上的每一帧都是手动操作滑块和种子输入框也能得到的结果，由同一条流程计算：只保留直边，像其他结果一样经过检查，并且可以导出。各帧算好一帧就显示一帧。帧与帧之间不做补间或变形过渡，因为那会凭空造出流程从未生成过的中间轮廓。Distortion 的**少数锚点**模式（few anchors）只有 Flicker 预设的 Load 会设置（第 7 节），它和其他设置一样只是设置的一部分：声音从不打开或关闭它。

## 3. 声音来源

- **File**（默认）：浏览器能解码的任何音频文件（WAV、MP3、AAC、OGG、FLAC，取决于浏览器）。有播放、暂停、循环和进度滑块，并通过扬声器播放。
- **Microphone：** 只有用户按下 **Start listening**、浏览器请求权限之后才会开始；选中 **Microphone** 只会显示这个按钮，并暂停文件。不回放，所以不会产生回授。Stop listening、切换来源和关闭标签页都会释放麦克风，使用期间会显示指示标记。
- 没有 **Off** 来源（最初的版本有，而且是默认）：Pause 停止文件，Stop listening 停止麦克风，选回 **File** 会释放麦克风。
- 无效、空白、静音和不支持的输入各有各的提示信息。麦克风的问题也一样：访问被拒绝、没有麦克风、麦克风打不开（被其他应用占用，或被浏览器中止）、打开了但无法接到分析器上、收音时停止了（被拔出或撤销了访问权限），以及页面不安全。浏览器没有指明的错误读作不支持，而不会读作设备被占用。

## 4. 音频特征

每个动画帧都从 Web Audio 的 `AnalyserNode` 计算特征：44.1 和 48 kHz 下是 2048 点 FFT（88.2 和 96 kHz 下加倍，使分析窗口保持约 43 ms），响度和音高用时域采样计算。分析器前面有一个 20 Hz 高通滤波器，去掉被测量信号里的直流偏移。

**立体声测量支路。** 高通滤波之后，声音还会被上混为正好两个声道（一个按扬声器规则混音的增益节点，所以单声道来源会变成完全相同的左右声道），再拆分开，每个声道由一个分析器测量；Pan 就来自这两个分析器。三个分析器是一个接一个读取的，音频线程可能在两次读取之间渲染（在 Chrome 中最多约 300 帧有一帧）。所以每一帧都会检查混合后的采样是否等于左右声道的平均值，不一致就把三个分析器重新读一遍，最多 3 次；都不一致时，Pan 沿用上一组一致的左右声道。（超过两个声道的来源永远不会一致，所以在保持一帧之后，直接使用读到的数据。）扬声器收到的文件声音和以前一样，麦克风也仍然只被测量，从不播放。

共有 10 个特征，分为五组，在 Sound 标签页中按这个顺序列出（`src/sound/mapping.ts` 中的 `FEATURES`）。除 Pan 外都在 0–1 之间。

| 组 | 特征 | 定义 | 归一化 |
|---|---|---|---|
| Loudness（响度类） | **Level**（响度） | 短时 RMS（去掉直流偏移），单位 dB | −60 dB → 0，0 dB → 1，按 **Sensitivity** 平移 |
| | **Swell**（缓变响度） | 缓慢平滑后的 Level：上升 300 ms，下降 2 s，不受 **Smoothing** 影响 | 同 Level |
| Bands（频带） | **Bass**（低频） | 20–250 Hz 的能量 | 相对于它自己的一个缓慢自适应的滑动最大值 |
| | **Mids**（中频） | 250–2000 Hz 的能量 | 同上 |
| | **Treble**（高频） | 2000 Hz 到奈奎斯特频率的能量 | 同上 |
| Tone（音色） | **Brightness**（亮度） | 20 Hz 到 20 kHz 的频谱质心，按对数频率刻度 | 100 Hz → 0，8 kHz → 1 |
| | **Pitch**（音高） | 在混合后的采样上用 YIN（阈值 0.15）求基频，采样先降到最多 24 kHz。无音高的帧保持上一个音；静音时为 0。 | 55 Hz → 0，1760 Hz → 1，按对数刻度（5 个八度） |
| Rhythm（节奏） | **Beat**（节拍） | 由两个基于频谱通量的检测器得出的起音：一个看整个频谱，一个只看 20–150 Hz（底鼓检测器），因为在宽频的声音下，底鼓可能淹没在全频带的通量里。每个检测器在通量超过自适应阈值时触发（最近一秒的中位数 × 一个系数，全频带为 1.5，底鼓频带为 3，再加一个下限，并且至少是上一次起音通量衰减后的一半，所以一次敲击自己的尾巴不会再次触发），两次至少相隔 100 ms。每次底鼓也会触发全频带检测器，所以两个检测器都听到的一次敲击只算一次起音。两个检测器都只在声音能量上升时触发（能量门，见下文），所以持续的声音，包括带嗡嗡声的低音，不会产生节拍。作为特征，它是一个脉冲，取两个检测器的脉冲中较大的那个。 | 每次起音时为 1，然后按 Smoothing 时间回落 |
| | **Activity**（活跃度） | 声音有多忙：取 **Change** 和 **Pace** 中较大的那个，一起平滑。Change 是 Beat 所判断的全频带频谱通量比它最近一秒的中位数高出多少（两次判断之间保持不变）；Pace 是最近 2 秒内每秒的 Beat 起音次数 | Change 相对于最近这种高出量的最大值（一个每 3 秒减半的滑动最大值），但比较的基准从不低于 Beat 的通量下限，也不低于这一帧压缩后频谱总和的四分之一：持续的声音接近 0，纯音和噪声都一样，起音处很高。Pace：每秒 8 次 → 1 |
| Stereo（立体声） | **Pan**（声像） | 左右声道 RMS（去掉直流偏移）的 (R − L) / (R + L) | −1（左）到 1（右）：唯一的双向特征 |

实际上 Pan 需要立体声文件：单声道文件或单声道麦克风读作居中。

**由 20 个合并而来。** 第 3 阶段最初测量 20 个特征，分为六组，后来合并成这 10 个：Low、Mid、High 改名为 Bass、Mids、Treble；六个窄频带（Sub、Bass、Low mid、High mid、Presence、Air）、Noisiness（噪声度）和立体声的 Width（宽度）被去掉；Kick（底鼓）变成 Beat 的第二个检测器；Change 和 Pace 合成 Activity，取两者中较大的那个而不是平均值，因为平均值会让范围减半，永远到不了 1；Balance 改名为 Pan。

- **Smoothing（平滑）：** 每个连续特征都以快速的起音（10 ms）和较慢的释放（默认 150 ms，由 **Smoothing** 设置）跟随声音，所以字母立即响应，但不会闪烁。有些特征用自己的时间常数：Swell（见上表）；Pitch 上下都用 30 ms，静音时按释放时间降到 0；Pan 上下都按释放时间变化；Beat 跳到 1，再按释放时间回落。
- **静音门限：** 低于静音阈值时，连续特征降到 0，也不会触发节拍。即使另一个频带很响，自身能量低于静音阈值的频带也读作 0。Swell 按自己的 2 秒回落，Activity 里的 Pace 则随着最后几个节拍离开它的 2 秒窗口而回落。
- **Sensitivity** 也会缩放起音通量所比较的幅度，即 ln(1 + 1000 g m)，其中 g = 10^(Sensitivity / 20)，所以它同样作用于 Beat。这与最初规格里的公式 ln(1 + 1000 m) 不同：按那个公式，Sensitivity 帮不了小声来源的起音检测。
- 起音每秒最多判断约 60 次，所以在 120 Hz 及更高刷新率的屏幕上，阈值的含义也相同。
- **Beat 的能量门**（`SOUND_LIMITS` 里的 `onsetRiseDb` 及其后几项）：持续的、谐波丰富的低音（锯齿波、方波或约 140 Hz 以下的嗡嗡低音）会骗过通量：分析器的窗口跨过相邻的谐波，每个频点以某个频率起伏，被帧率混叠成每秒几次到 19 次的起伏，而通量的中位数仍接近 0。这样的音会让 Beat 每秒触发 5–11 次，其上的底鼓也有一半淹没在误触发里。所以只有当某个倍频程频带比它最近 100 ms 内的最高值上升至少 2 dB 时，检测器才会触发。频带从 20 Hz 开始（20–40、40–80 Hz，依此类推，最后一个一直到奈奎斯特频率）；底鼓检测器只看起点低于 150 Hz 的频带。频带能量以加上 Sensitivity 之后的 dB 计，且不低于静音阈值。一个频带之前的能量，在它此后下降超过 12 dB 时就不再计入：两次敲击之间声音已经消退，所以和第一次一样响的第二次敲击仍算新的起音（没有这一条时，每秒 12 次的踩镲从每秒 6.9 个节拍降到 1.2 个）。测得：持续的锯齿波低音最多上升 2.0 dB，敲击至少 2.3 dB，多数在 5 dB 以上；持续的嗡嗡声最多下降 9.4 dB，而每秒 10 次的敲击之间会下降 14–27 dB。已知限制：被同一倍频程里更响的声音掩盖的敲击（比低音音符弱 12 dB 的底鼓）会漏掉；在完整的锯齿波低音下，也会有一些真正的底鼓被拦下。
- 处理分母为零的情况，并截断离群值。

## 5. 映射

一个映射把一个特征连接到一个目标参数。Sound 标签页最多容纳 8 个映射，每个都有开关。10 个特征中的任何一个都可以驱动任何目标；效果取决于目标的类型。

- **滑块目标**（任意特征 → 一个滑块）：
  - 实时位置 = 滑块位置 + **Depth** × 特征，截断到滑块两端，再取整到滑块的档位。位置沿滑块的绘制方向计算（0–1），所以普通滑块相当于 滑块值 + Depth × 特征 × 滑块的全部范围，而对数刻度的滑块（如 Tolerance）沿滑道均匀移动。
  - Depth 从 −100% 到 100%。Depth 为负时，声音越响，值越小。Pan 的范围是 −1 到 1，所以它让滑块双向移动：声音偏左时往一边，偏右时往另一边。
  - Beat 是脉冲，所以用在滑块上时，值在每次起音时按 Depth 跃起，再在 Smoothing 时间内回落到滑块值。
- **种子目标**（跳变）：Distortion · Seed、Random anchors · Seed 和 Experimental 的 Seed。换一个新种子，每个锚点就落到新的地方，所以种子每跳变一次就前进一个。该行的滑块显示 **Rate**（频率，0–100%），而不是 Depth：
  - 用 Beat 时，种子随起音前进：Rate 100% 每次起音都前进，50% 每隔一次，25% 每四次一次。
  - 用其他特征时，跳变频率最多为每秒 4.8 次 × Rate × 特征值（Pan 取其大小，偏左偏右都一样）。两次测量之间的间隔最多按 100 ms 计算，所以卡顿之后不会一下子放出一串跳变。
  - 同一帧里要跳变的种子一起跳；超出闪烁限制（第 10 节，种子和被驱动的滑块共用）的跳变会被跳过。
  - 实时种子是输入框范围（0–999 999）内的整数，超过最大值后回到 0，所以每个实时帧仍然是面板本身能给出的一组值（第 2 节）。
  - Rate 不分正负：如果某行的 Depth 为负，选择种子目标时会把它变成正值。
- **Step（步进，尚待完成）：** 只有几个可选值的参数在每个节拍换到下一个，例如 Allowed directions（角度步长）15° → 30° → 45° → 90°、Sides 或 Rings。
- **同一目标上的多个映射：** 在滑块上，它们的作用相加，再截断总和。在种子上，每个映射各自累计跳变，种子每帧最多前进一个。每行都写明自己的目标，被驱动滑块上的标记显示合计后的实时值。
- **选择目标时会打开它所需的设置：**
  - 用户选择一个所需设置未打开的目标（它的步骤、效果或模式；第 6 节）时，这个设置会被打开，行下方的提示说明改了什么，例如 "Turned on Ripple."、"Set Noise amplitude to 40." 或 "Turned off Random anchors. Set Mode to Adaptive."。**Add mapping** 添加的行也一样，而且它优先选已经起作用的目标：它添加 +50% 的 Level，如果还没有行使用 Distortion · Noise amplitude 就映射到它，否则映射到第一个未被使用且已经起作用的目标。
  - 把这一行换到另一个目标，或删除这一行，都不会关闭任何设置。
  - **Load** 是唯一的例外（第 7 节）：它在设置预设之前先把 Geometry 和 Experimental 的设置恢复为默认值，所以可能会关闭一些设置，并在 Preset 一行下方说明。它是一个撤销步骤，所以撤销会恢复之前的设置和映射。手动选择目标仍然只会打开该目标所需的设置，不会恢复任何默认值。
  - 如果用户之后又把这个设置关掉，该行会说明目标为什么不起作用，并提供 **Enable** 按钮，点它会重新打开设置并显示提示。
  - 用键盘浏览 Target 列表时，途经的选项不会打开任何设置：按 Enter 或焦点离开列表时才生效。用鼠标选择则立即生效。
- **基准值保持不变：**
  - 滑块保留自己的值，Sound 实时运行时滑块不动；每个被驱动的滑块上有一条细标记显示实时值。
  - 种子输入框保留自己的种子；旁边一个小数字显示实时种子。Distortion 和 Random anchors 的统计数字也显示实时种子，因为它们描述的是屏幕上显示的字母。
  - Depth 或 Rate 为 0，或映射关闭时，得到的就是滑块值或种子本身。
  - 映射到步骤、效果或模式未打开的目标时不起作用，该行会注明。
  - 没有载入字体时没有字母可动，所以 Sound 不驱动：什么都不变，标记和实时种子保持隐藏，状态栏不显示 Live，种子也不跳变。载入字体后才开始驱动；Sound 驱动时字体没了，滑块和种子会完全恢复。
- **和设置一起保存与撤销：**
  - 映射和设置一起保存在浏览器里，下次打开时恢复。Drive letters 不保存：它开始时是打开的，开启减少动态效果时则是关闭的（第 10 节）。Sensitivity 和 Smoothing 也不保存。
  - 添加或删除一行，改变它的 Feature、Target 或开关，拖动一次 Depth 或 Rate（每次拖动一步），选择目标连同它打开的设置，Load，以及 Freeze，各是一个撤销步骤，和设置共用同一段历史。撤销和重做也会清掉上一次 Load 或所选目标的提示，因为它们已不再描述当前状态。实时帧从不进入历史。

## 6. 目标

**Geometry 标签页**，"锚点跳动"就在这里：

| 目标 | 建议的驱动 | 看到的效果 |
|---|---|---|
| Distortion **Seed** | Beat，Rate 100%；或 Level | 每个节拍所有锚点都跳到新位置，或者声音越响跳得越频繁（在 Flicker 设置的少数锚点模式下，改为每个字母换一组新的少数几个锚点移动） |
| Distortion · **Noise amplitude** | Level，或 Beat（脉冲） | 声音响时锚点抖得更厉害，或在节拍处弹出再回稳 |
| Distortion · **Noise frequency** | Brightness | 声音越亮，边缘越细碎、越抖 |
| Random anchors **Seed** | Beat，Rate 100% | 每个节拍都在新位置重新采样锚点 |
| Random anchors **Randomness** | Level | 响时锚点散开；静时均匀排列 |
| Random anchors **Density** | Bass，按档 | 低音时锚点更少、更粗大 |
| Curve flattening · **Tolerance** | Level | 响亮的段落更粗糙、更像多边形 |
| **Squaring** amount | Mids | 碗形随人声变方 |
| Anchors · **Anchor spacing** / **Anchor reduction** | Treble / Level | 锚点变密或减少 |
| **Grid** size | Bass，按档 | 低音时吸附到更粗的网格 |
| Grid & angles · **Allowed directions**（角度步长） | Beat → Step（尚待完成） | 边依次锁定到 15°、30°、45°、90° |

以下也是目标，但没有建议的驱动方式：Curve flattening 的 Segments per curve 和 Corner angle，以及 Distortion 的 Normal bias。完整列表按面板顺序见 `src/sound/mapping.ts` 中的 `TARGETS`（README 的“目标”一节）：共 43 个目标，其中三个种子是跳变目标，其余都是滑块。Allowed directions 会随 Step 映射成为目标。

**Experimental 标签页**：Crumple 的 Amount / Detail / Facet size / Turn；Ripple 的 Amount / Wavelength / Sides / Center X / Center Y / Fade / Petals；Whorl 的 Amount / Rings / Sides；Slipstream 的 Direction / Strength / Slip / Gust size / Gustiness / Cuts / Trails；Thorn 的 Anchors / Reach / Root / Spread / Width / Refraction / Flute width；以及共用的 **Seed**（Beat，Rate 100%），因为它的分组在标签页最下方，所以排在最后。Target 列表里它只显示为 "Seed"；其他目标都显示为 "Section · Label"，例如 "Distortion · Seed"。旧的保存设置里缺少的字段按面板显示的值读取：Crumple 的 Detail 为 50%，Thorn 的 Root 为 50%、Flute width 为 10%，Crumple 的 Turn、Ripple 的 Petals、Slipstream 的 Slip、Cuts、Trails 和 Thorn 的 Refraction 为 0。

**目标起作用需要什么**（即它的未生效说明，以及选择它时会打开什么，见第 5 节）：

| 目标 | 需要 | 选择它时 |
|---|---|---|
| Curve flattening 的 Tolerance、Segments per curve、Corner angle | Random anchors 关闭（它会取代扁平化） | 关闭 Random anchors |
| Curve flattening 的 Tolerance | Mode 为 Adaptive | 把 Mode 设为 Adaptive |
| Curve flattening 的 Segments per curve | Mode 为 Fixed segments | 把 Mode 设为 Fixed segments |
| Curve flattening 的 Corner angle | Merge joined curves 打开，两种 Mode 都可以 | 打开 Merge joined curves |
| Grid & angles 的 Grid size | Snap to grid 打开 | 打开 Snap to grid |
| Distortion 的 Noise frequency、Normal bias、Seed | Noise amplitude 大于 0（为 0 时 Distortion 不起作用） | 把 Noise amplitude 设为 40 |
| Random anchors 的 Density、Randomness、Seed | Random anchors 打开 | 打开 Random anchors |
| Random anchors 的 Seed | Randomness 大于 0%（为 0% 时锚点均匀分布，种子没有可选的） | 把 Randomness 设为 100% |
| Crumple、Ripple、Whorl、Slipstream、Thorn 的滑块 | 对应效果打开 | 打开对应效果 |
| Thorn · Flute width | Thorn 打开，然后 Refraction 大于 0%（0% 时面板把 Flute width 变灰） | 打开 Thorn，把 Refraction 设为 50% |
| Experimental 的 Seed | Crumple、Slipstream 或 Thorn 打开（Ripple 和 Whorl 没有随机性） | 打开 Crumple |

Squaring、Anchors 和 Distortion 的 Noise amplitude 始终起作用。只要 Merge joined curves 打开、Random anchors 关闭，Corner angle 就起作用，与 Mode 无关：面板把它和合并相关的控件放在一起显示，而这些控件是两种模式共用的。

开关（Use crumple、Pin top and bottom 等）、Curve flattening 的 Mode，以及 Distortion 的少数锚点模式都不是目标：声音从不打开或关闭任何步骤。只有选择目标（或 Add mapping、Enable）会打开设置，而且只打开一次；Load 则恢复默认设置并设好预设自己的值（第 7 节）。这些都和在面板上普通地修改设置一样。

## 7. 预设

预设是现成的起点（`src/sound/presets.ts` 中的 `PRESETS`）：每个预设除了映射，还会设好几个起始的滑块值。大多数预设只用 Geometry 标签页及其默认滑块，所以安静时字母仍然清楚可读；每个预设最多打开一个 Experimental 效果。

在 **Preset** 列表里选中一个只是选中它。**Load**（`presetSettings`，纯函数）：

1. 把 Geometry 和 Experimental 的每个设置都恢复为默认值（Curve flattening、Random anchors、Squaring、Anchors、Grid & angles、Distortion，以及每个 Experimental 效果），但保留三个种子（Distortion、Random anchors 和 Experimental 的种子）。Typography、Color、画布，以及 Sound 标签页的来源、Drive letters、Sensitivity 和 Smoothing 都不动。
2. 设好预设的起始值。
3. 用预设的映射替换当前的映射，并清除之前各行的提示。
4. 在 Preset 一行下方显示提示：先是 “Loaded X.”（已载入 X），然后用 “Turned off ….” 列出原来打开、现在被关闭的 Experimental 效果（Crumple、Ripple、Whorl、Slipstream、Thorn），Random anchors 被关闭时接着是 “Turned off Random anchors.”，如果预设没有设置的其他设置有被恢复为默认值的，最后是 “Other Geometry and Experimental settings back to defaults (seeds kept).”（其他 Geometry 和 Experimental 设置已恢复默认，种子保留）。例如：“Loaded Bloom. Turned off Crumple and Slipstream. Other Geometry and Experimental settings back to defaults (seeds kept).”。这条提示一直保留到下一次 Load、在列表里选了另一个预设，或者撤销或重做为止，屏幕阅读器会读出它。

Load 是一个撤销步骤：撤销会恢复它之前的设置和映射，种子也一样。

所以无论之前设了什么，每个预设都从同样的字母开始，它的各行也不需要再打开任何设置。万一某一行仍然需要，就像手动选择目标时一样（第 5 节）逐行打开，并在该行显示提示。手动选择目标仍然只会打开它所需的设置，不会恢复任何默认值。

括号里是 Depth，即滑块行程的比例（负值让滑块往下走）；在种子上是 Rate。起始值只列出与默认值不同的部分。

| 预设 | 映射 | 起始值 | Experimental 效果 | 看到的效果 |
|---|---|---|---|---|
| **Flicker** | Level → Distortion · Noise amplitude（90%）；Beat → Distortion · Noise amplitude（30%）；Beat → Distortion · Seed（Rate 100%） | 少数锚点模式打开；Noise amplitude 2；Normal bias 90% | 无 | 每个节拍，每个字母换另外几个锚点跳动，其余锚点撑住字形；声音越响、每个节拍，它们都跳得更远 |
| **Scatter** | Level → Random anchors · Randomness（90%）；Level → Random anchors · Density（−9%）；Beat → Random anchors · Seed（Rate 50%） | Random anchors 打开；Density 10；Randomness 5% | 无 | 每隔一个节拍重新放置锚点：安静时密而均匀，越响越稀疏、越不均匀 |
| **Pixel** | Bass → Grid & angles · Grid size（70%）；Treble → Anchors · Anchor reduction（40%） | Snap to grid 打开 | 无 | 字母吸附到网格上，低音让网格变粗；嘶声和镲片让锚点减少 |
| **Low poly** | Level → Curve flattening · Tolerance（70%）；Brightness → Anchors · Anchor reduction（40%） | Merge joined curves 打开 | 无 | 响亮的段落把曲线压成更少、更长的边；明亮的声音让锚点减少 |
| **Block** | Swell → Squaring · Amount（90%）；Beat → Squaring · Amount（30%） | 无（全部默认） | 无 | 音乐渐强时圆形笔画变方，每个节拍再方一点 |
| **Jitter** | Treble → Distortion · Noise amplitude（60%）；Brightness → Distortion · Noise frequency（30%） | Noise amplitude 2；Noise frequency 20 | 无 | 嘶声和镲片让轮廓颤动；声音越亮，颤动越细碎 |
| **Facet** | Level → Curve flattening · Segments per curve（−15%）；Beat → Curve flattening · Segments per curve（−5%）；Pitch → Curve flattening · Segments per curve（20%） | Mode 为 Fixed segments；Merge joined curves 打开；Segments per curve 6 | 无 | 越响、每个节拍时，曲线碎成少数几条直边；音越高，又变得平滑 |
| **Bloom** | Beat → Ripple · Amount（10%）；Bass → Ripple · Petals（5%） | Ripple 打开，Amount 30% | Ripple | 波纹穿过字母，每个节拍时涌起；低音把波纹弯成花瓣 |
| **Flare** | Beat → Seed（Rate 100%）；Level → Thorn · Reach（30%）；Beat → Thorn · Anchors（15%） | Thorn 打开，Anchors 1，Reach 0% em，Root 25% | Thorn | 越响，每个字母就有几个锚点射出刺；每个节拍它们都跳到新的地方，并短暂变多 |
| **Gale** | Level → Slipstream · Slip（50%）；Beat → Slipstream · Cuts（40%）；Activity → Slipstream · Trails（35%） | Slipstream 打开，Strength 0%，Slip 0% em，Cuts 0，Trails 0 | Slipstream | 响度让字母的切片彼此错开；节拍顺着气流切出细缝，繁忙的段落拖出拖尾 |

- **Flicker** 打开 Distortion 的**少数锚点**模式。它没有自己的控件，也不是 Sound 的目标：只有这个预设会设置它，Reset distortion 或载入另一个预设会把它关掉。每个字母只有 1–5 个锚点移动，拐角和最外侧的点从不移动，每个移动的锚点至少移动幅度的 60%，换一个种子就换一组锚点（见 README 的“顶点扰动”和 PRD 的 P1）。很小的幅度 2 让 Distortion 保持打开，所以安静时 Seed 那一行也起作用。
- **Jitter** 的幅度 2 同理，让它的 Noise frequency 那一行在安静时也起作用。
- **Low poly** 合并相连的曲线，所以较大的 Tolerance 能作用到整个碗形（不合并时，字体里的每段曲线至少保留一条边）。**Facet** 也合并曲线，所以它的段数按合并后的曲线（四分之一个碗形）计算，而不是按字体里的每段曲线计算。
- **Flare** 从 Reach 0 开始，所以安静时没有刺，也没有根部的拉动；Root 设为 25%（默认值的一半），让笔画保持可读。Thorn 一开始就打开，所以它的 Seed 那一行不需要再打开任何设置，Crumple 也保持关闭。
- **Gale** 开始时 Strength、Slip、Cuts、Trails 都为 0，所以安静时什么都不会被气流带动。它从不驱动 Strength：拉伸会把字母推到相邻的字母上。
- **Bloom** 的 Petals 那一行只在 0% 和 10% 之间切换，低音一起来就到 10%（滑块的档位是 10%，而 20% 很难看清）。
- **第 3 阶段重新调过：** 特征合并时，用 Kick 的行改用 Beat（Block、Facet、Bloom 的 Depth 也调小了），Low poly 的 Noisiness 那一行改为 Brightness，Pixel 和 Jitter 改读 Bass 和 Treble。Experimental 效果重做后，Flare 和 Gale 按 Thorn 和 Slipstream 重新设计。每个预设都在 Arial 和 Georgia 上，在静音、完整混音、节拍峰值和最大响度下看过：字母都保持可读。

## 8. 架构与性能

- **新代码放在 `src/sound/`：**
  - `types.ts`：共用的类型、上下限和静音特征帧。
  - `engine.ts`：Web Audio 音频图及其来源，包括立体声测量支路（第 4 节）。
  - `useSound.ts`：访问音频引擎及其帧的 React hook。
  - `features.ts`：从频谱、采样以及左右声道中提取特征（无需音频即可测试）。
  - `mapping.ts`：特征列表（`FEATURES`，分五组）、目标列表（滑块和种子，每个都带有它起作用所需的设置，以及打开这些设置的修改 `activate`），以及 滑块值 + 特征 + 映射 + 跳变 → 实时参数（`modulate`，纯函数）。每个滑块目标的范围和档位都取自 `src/state/sliderScales.ts`（`SLIDER_RANGES`，按目标 id 索引；对数刻度的 Tolerance 滑块用 `TOLERANCE`），面板也用同一张表构建滑块，所以实时值总是滑块自己能给出的值，两边不会不一致。
  - `flash.ts`：闪烁限制的共用预算（`FlashBudget`、`FLASH_LIMITS`，第 10 节），被驱动的滑块和种子的跳变都从中支取（纯逻辑）。
  - `jumps.ts`：`JumpTracker`，根据测量到的帧累计每个被驱动种子的跳变，每个跳变帧都从闪烁预算中支取；以及 `JUMP_LIMITS`，其中 `maxRate`（4.8）由 `FLASH_LIMITS` 算出（纯逻辑，无需音频即可测试）。
  - `mappingStore.ts`：一个带 hook 的小型存储，保存映射和 Drive letters（驱动字母）开关；页面打开期间跟随 `prefers-reduced-motion` 的变化。它的修改会记入撤销历史（`src/state/history.ts`），映射随会话一起保存（`src/state/persist.ts`）；Drive letters 两者都不参与。
  - `presets.ts`：预设列表（`PRESETS`，第 7 节），每个预设带有名称、它的 ⓘ 里显示的一行说明、起始值和它的映射；以及 `presetSettings`（纯函数），给出 Load 之后的结果：设置（Geometry 和 Experimental 的每个分组都恢复默认、保留种子，再设上起始值）、改变了的分组，以及提示。
  - `live.ts`：帧调度（`LiveScheduler`，持有闪烁预算、`FlashLimiter` 和 `JumpTracker`；它的依赖 `LiveDeps` 是注入的，`tests/sound` 用假时钟、假几何客户端和假 React 替换它们）、滑块上的闪烁限制（`FlashLimiter`）、提供实时参数、实时标记位置、实时种子（`useLiveSeed`）和实时状态的 hook，以及 Freeze。标记组件本身是 `src/components/LiveMarker.tsx`，种子输入框旁的实时种子是 `src/components/LiveSeed.tsx`。
- **流程不变；实时请求带 `live` 标记。** 实时参数作为带 `live` 标记的计算请求发给几何 Worker；Worker 本来就会在字形之间丢弃已被取代的请求。这个标记只让实时结果存入单独的实时缓存（见下文），几何的计算方式不变，而且只在 Worker 里计算：页面自己从不计算字形。调度器先向 Worker 要一个实时帧的字形（`geometryClient.prefetch`），等它们全部到达后才把这一帧交给 React，所以每一帧只渲染一次，而且是完整的（第 2 节）。提交仍然每秒最多 30 次；一次提交如果一直没有渲染，从提交时算起 1 秒后就不再挡住下一次。
- **没有字体就不驱动：** 调度器会被告知是否载入了字体。没有字体时，它不提交任何东西，不显示标记和实时种子，不报告实时状态，种子也不跳变；Sound 驱动时字体没了，滑块和种子会完全恢复（第 10 节）。
- **跟随实时参数的：** 字母、文字预览、画布上画出的吸附网格和状态栏的描述。保持滑块值的：滑块、导出，以及 Typography 标签页里的 Fit text 和 Free（和导出一样，它们测量滑块值下的字母）。
- **自适应帧率：**
  - 特征每个动画帧更新一次。
  - 同一时间最多只有一个几何请求在处理；上一个完成后才发下一个，所以帧率随计算量变化。
  - 帧率上限为 30 fps，Sound 标签页会显示当前帧率。
  - 低于约 8 fps 时，会建议用更轻的设置或更短的文字。
- **实时值取整：** 每个值都取整到所在滑块的档位（种子本来就是整数），这样重复的值会命中几何缓存，而不必重新计算。
- **单独的实时缓存：** 实时帧使用自己的小缓存（约 600 条），所以一首歌不会把正常编辑时缓存的结果挤掉。
- **范围：** 和现在一样，只计算文字里的字形和当前选中的字形。
- **空闲时的音频：** 音频上下文在第一次需要它的用户操作（选择文件或来源、Play、Start listening）中创建，没有播放也没有收音 2 秒后会暂停，Play 和 Start listening 会让它恢复。注意：在 Safari 中，之后用媒体键重新开始的播放可能没有声音，直到用户按下 Play。
- **实测耗时：**
  - 只有 Geometry 时，每个字形约 0.1 ms。
  - 所有 Experimental 效果同时翻折时，每个字形最多约 20 ms，对较长的文字来说太重，无法实时使用。
  - 实时帧（在 worker 中测量；Node、Arial、默认文字的 24 个不同字形，特征扫动时取 30 帧）：Level → Distortion 的 Noise amplitude 约 2.6 ms，Level → Crumple Amount 7.4 ms，Bass → Ripple Petals 6.2 ms，三者同时 12.3 ms，都达到 30 fps 上限。Crumple、Ripple、Whorl、Slipstream 全开时每帧约 41 ms（约 24 fps）。重复的值命中缓存，不到 0.1 ms；页面上排布字形和画板每次渲染约 0.3 ms。第 3 阶段完成后重新测量，结果在每次运行的波动范围内相同：2.4 ms，三者同时 12 ms，全部打开 37–41 ms（24–27 fps）。Experimental 的这些数字是在 Crumple、Slipstream 和 Thorn 重做（EXPERIMENTAL_PLAN 第 4.9 节）之前测的，重做让它们都变重了（默认设置下每个字形约 0.6–0.9 毫秒），实时帧还没有重新测量。
  - 种子跳变一次就是一组新参数，所以每个不同的字形都要重新计算：在 worker 中每个跳变帧约 2–3.5 ms（同样的设置，Beat 分别驱动三个种子），远在 30 fps 上限之内。
  - 特征提取（`process`，Node，48 kHz）加入第 3 阶段的特征后，每帧从约 35 µs 增加到约 90 µs，主要来自 Pitch；合并成 10 个之后仍是这个水平（在类似音乐的混音上 89–93 µs）；累计跳变不到 1 µs。
  - 页面上，Geometry 和 Experimental 标签页的控件以及字形列表会跳过实时帧，除非它们自己的统计数字变了（`React.memo`）：在生产构建中（Arial、默认文字、驱动 Noise amplitude），每个实时帧的页面 JavaScript 从约 5.3 ms 降到约 4.5 ms。种子输入框旁的实时种子自己订阅更新（`LiveSeed`），所以这些控件不需要新的属性；只有 Distortion 和 Random anchors 会在实时种子变化时为统计数字额外重新渲染。
  - 因为实时帧要等字形到齐才交给 React，页面现在每帧只渲染一次，而不是两次。
  - 尚未测量：每帧把结果复制到页面并重绘 SVG，这是主线程上的主要风险。在浏览器中测量（第 3 阶段尚待完成），只有它限制帧率时才把实时视图改为 canvas 绘制。

## 9. 冻结、导出与可重复性

- **Freeze** 把屏幕上的实时值写入滑块，把屏幕上的实时种子写入种子输入框，并让声音暂停（暂停文件或停止收音），所以冻结下来的样子会留在屏幕上。它就成了普通的、可重复的设置，也是一个撤销步骤；按 Play 或 Start listening 可以继续。只要声音在驱动字母，它就可用（不会随节拍闪烁）；如果按下时字母正好和滑块一致（例如两次鼓点之间），它只会暂停声音。
- 导出（SVG、PNG、OTF）始终使用滑块值，从不使用实时音频。Sound 实时运行时，Export 对话框会说明这一点，并指向 Freeze。
- 实时输出取决于时机，不可重复；冻结后的设置可以重复。
- 视频录制以后再做。

## 10. 安全与无障碍

- **闪烁：** 快速的摆动可能造成闪烁（WCAG 的三次闪烁阈值）。
  - **所有映射共用一个预算**（已完成，`src/sound/flash.ts` 里的 `FlashBudget`）：屏幕上的每一次大变化（一个边沿），无论来自哪个被驱动的滑块还是哪个种子，都从同一个预算中支取：任意 1.25 秒内最多 6 个边沿，所以不管有多少映射，Sound 每秒最多造成 3 次闪烁。边沿按测量帧的时间在 1.25 秒（比一秒稍长）内计数，所以晚到最多四分之一秒（等待几何计算）才到达屏幕的帧，在屏幕上任意一秒内也不超过 6 个。同一测量帧里的边沿（滑块的折返和种子的跳变）会一起到达屏幕，只算一次。
  - 连续映射（已完成）：每个被驱动的滑块有一个方向，以及它朝这个方向到过的极值；从极值往回走就是折返。当各滑块往回走的距离加起来达到一个滑块滑道的 10% 时，这一帧算一个边沿：可以是一个滑块摆这么远，也可以是几个较小的摆动一起，所以几个滑块同步、各自不到 10% 的摆动也绕不过这个限制。折返按显示出来的滑块位置（取整到档位之后）计数。预算用完时，正在往回走的滑块保持上一个值，直到预算空出来，其余滑块照常；保持的值是滑块片刻之前给出的值（第 2 节），标记和 Freeze 也使用它。
  - 用在滑块上的 Beat 也是连续映射，所以同样的限制也约束它的脉冲。
  - 种子（已完成）：一个跳变帧（同一帧里一起跳变的所有种子）从同一个预算中支取一个边沿。超出限制的跳变会被跳过，而不是推迟或攒起来，因为推迟的跳变已经跟不上声音了。用其他特征时，在没有滑块摆动的情况下，每秒 4.8 次跳变（Rate 100%、特征为 1 时）就是这个限制平均允许的最大值；滑块越忙，留给跳变的就越少。
  - 暂停、停止、关闭 Drive letters 或字体没了时，滑块和种子回到自己的值（完全恢复），再次播放时从这些值开始。预算在此期间保留它的边沿；回到原值本身也支取一个边沿（不论预算怎么说，它都会显示出来），所以快速暂停再播放不会放出第二串变化。
  - 在测试音轨上，Beat → Distortion · Seed 在只有底鼓的段落每秒跳变 1.89 次（即节拍频率），在每秒 8 个节拍时被限制在每秒约 4.3–4.5 次，屏幕上任意一秒内种子最多变化 6 次。
- **减少动态效果：** 开启 `prefers-reduced-motion` 时，**Drive letters** 默认关闭（电平表照常工作），Sound 标签页会说明原因；页面打开期间才开启减少动态效果时，它也会自动关闭。
- **麦克风：** 只在用户明确点击后启用，显示可见的指示标记，停止时释放。
- **不联网：** 什么都不上传，音频不会离开浏览器。

## 11. 界面

所有标签都用英文，尽量简短，说明收在 ⓘ 按钮里。

- 第三个标签页 **Sound**，在 Geometry 和 Experimental 旁边。和现在一样，浏览器会记住选中的标签页。这个标签页的控件在第一次打开时才加载，之后一直保留。
- **Source（来源）：** File / Microphone，默认为 File（没有 Off）。File 有 Choose file、播放/暂停、Loop、进度和文件名。Microphone 有 Start listening / Stop listening 和使用中的指示标记；选中它会暂停文件，选回 File 会释放麦克风。
- **电平表**（Levels 分组）：
  - 每个特征紧凑地占一行（名称、条形、数字），按五个组各有一个小标题，每个标题带一个 ⓘ，用通俗的话解释该组的电平表。
  - 数字：Level 以 dB 显示，Pitch 以 Hz 显示（静音时为 "—"），Pan 显示偏向哪一边（"L 40"、"R 40"，离中心 5% 以内为 "C"），其余以百分比显示；没有播放时为 "—"。Pan 的条形从中间向左或向右填充。
  - Beat 是脉冲条：每次起音时跳到满格，然后回落。它取代了原来的指示灯，并且和所有条形一样没有过渡动画，所以开启减少动态效果时照样工作。
  - 条形每帧更新，数字每秒最多更新 10 次，提供给屏幕阅读器的值每秒最多 4 次。
- **Sensitivity**（输入增益）和 **Smoothing**（释放时间）。
- **Drive letters：** 一个开关（`role="switch"` 的复选框，画成按主题配色的小滑轨和圆钮）；只有打开时声音才会移动字母。开启减少动态效果时它一开始是关的，并说明原因（第 10 节）。
- **映射：**
  - **Preset** 和 **Load**，在各行上方，带一个 ⓘ，说明 Load 会恢复哪些默认值、撤销可以恢复之前的设置和映射，并给每个预设一行说明。在列表里选择只是选中，所以用键盘浏览列表不会替换任何东西；按 Load 才应用预设（第 7 节）。这一行下方有一个状态行，说明上一次 Load 做了什么（“Loaded X. Turned off …. Other Geometry and Experimental settings back to defaults (seeds kept).”），一直保留到下一次 Load、在列表里选了另一个预设，或者撤销或重做为止。
  - 每行有 Feature（与电平表相同的分组）、Target（分组：Geometry / Experimental；选项显示为 "Section · Label"，Experimental 的种子只显示 "Seed"）、Depth 和开关。在种子上，Depth 显示为 **Rate**，0–100%，步长 5%，并带一个 ⓘ，其中也说明种子和滑块共用每秒 3 次闪烁的限制，滑块越忙，跳变就越少。行内控件的名称带行号（“Remove mapping 2”）；目标当前不起作用时，行下方的说明也是 Target 的描述。
  - 行下方：选择目标时打开了什么的提示，一直保留到该行的目标再次改变；或者，目标不起作用时，说明原因并提供 **Enable**（屏幕阅读器读作 “Enable, mapping 2”）。
  - **Add mapping** 和每行一个删除按钮。删除一行后，键盘焦点移到下一行的删除按钮（没有时移到上一行的，都没有时移到 Add mapping）。
- **Freeze** 和 **Reset sound**。
- **状态栏：** Sound 驱动字母时显示 "Live · N fps"（没有载入字体时从不显示）。
- **被驱动的滑块：** 显示实时值标记。**被驱动的种子输入框：** 在输入框旁以标记的颜色显示实时种子。

## 12. 验证

- **特征：** 用合成信号测试：
  - 静音得到 0，没有节拍。
  - 100 Hz 的纯音读作 Bass、偏暗；5 kHz 的纯音读作 Treble、偏亮。
  - 120 BPM 的咔嗒声每秒约 2 个节拍。
  - 白噪声读作偏亮。
  - 响度随振幅升高。
  - 第 3 阶段（已检查；18 项检查，特征合并成 10 个之后重新运行）：静音和 −90 dBFS 的噪声让每个特征都为 0；40 和 100 Hz 的纯音填满 Bass，700 Hz 填满 Mids，5 和 10 kHz 填满 Treble，另外两个频带都为 0，频带的滑动最大值每 3 秒减半；Pitch 把 110–880 Hz 的正弦波和锯齿波放在刻度上应在位置的 0.1% 以内（16、32、44.1、48 和 96 kHz 下），音符之后的噪声会让它保持住；每秒 2 次的咔嗒声给出值为 1、按释放时间回落的 Beat 脉冲，Activity 在每次咔嗒时超过 0.6，之间保持在 Pace 的 0.25 附近，120 fps 下也一样；每一下底鼓都触发 Beat；持续的声音（110 Hz 锯齿波、和弦、白噪声或粉红噪声）上，Change 最多让 Activity 比 Pace 高 0.15（测试音轨上：和弦一段约 0.43，有踩镲的各段 0.91–1）；只有左声道和只有右声道时 Pan 分别为 −1 和 1，单声道和左右互不相关的噪声为 0；Swell 按自己的 300 ms 和 2 s 上升和回落。
  - Beat 的能量门（已检查，在理想的分析器和带渲染量子、帧抖动的类浏览器分析器上）：41–110 Hz 的持续锯齿波低音、方波低音、低频正弦波、45 和 60 Hz 的谐波以及粉红噪声，每秒都不到 0.5 个节拍；每秒 2 次的底鼓，单独或叠在低频正弦波或谐波上，至少 85% 被检出，误触发每秒不到 0.5 次；在完整的 55 Hz 锯齿波下，误触发仍每秒不到 0.5 次，但会漏掉一些底鼓。
- **调制：** Depth 为 0 或映射关闭时得到滑块值；值会被截断；多个作用相加；已关闭组里的目标不起作用；Beat 在释放时间内回落；Step 循环切换；频率限制有效；每秒 4 次的节拍在满 Depth 下，任意一秒内最多让滑块折返 6 次，每个值都落在滑块的档位上。
  - 共用的闪烁预算（已检查）：一个滑块、三个或五个同步或不同步的滑块、五个同步各摆 4% 的滑块、单独一个 Beat 种子，以及滑块加 Beat 种子，在任意一秒内都最多 6 次大变化（按帧和按屏幕分别测量），而只要音乐要求，每秒仍至少有 4 次通过。
  - 每个滑块目标的范围和档位都取自 `SLIDER_RANGES`，并且只给出滑块自己能给出的值。
  - 第 3 阶段（已检查）：10 个特征及其分组；43 个目标中的每一个，在 3000 组随机参数上（Refraction 也随机变化），都是恰好在起作用时不需要打开任何设置，它的修改能让它起作用，并且不改动其他任何东西；旧设置缺少重做后效果的七个字段时，这七个目标按面板显示的值读取，Thorn 和 Refraction 处于任何状态时 Flute width 的提示都正确；种子超过最大值后回到 0，而且从不移动滑块；Beat 在 Rate 100%、50% 和 25% 时分别在每个、每隔一个和每四个节拍跳变；Level 为 1、Rate 100% 时每秒约 4.8 次跳变；每秒 16 个节拍时，任意 1.25 秒内的跳变帧从不超过 6 个；2 秒的卡顿最多带来一次跳变；暂停后回到输入框的种子，Freeze 写入屏幕上显示的实时种子。
- **没有曲线与有效性：** 每个实时帧都是一组普通参数，已被现有审计覆盖。此外，记录一段测试音轨经过的参数组，在 Arial、New York 和 Georgia 上跑有效性审计和像曲线的段落审计。第 3 阶段（已检查）：在整段测试音轨上，同时映射到种子和滑块，878 次实时提交中的每一次都是面板能给出的一组值（滑块值落在档位上，种子是范围内的整数），种子每次变化都恰好前进一个。
- **音频引擎：** 在模拟的 Web Audio 节点上，立体声支路按第 4 节连接，测量用的节点都不通往扬声器，读取错位时会重读或保持。在 Chromium 中连续不断地探测读取，确实出现了错位，经过检查后没有一次传到特征里。
- **控件：** 面板里每个目标恰好有一个实时值标记（滑块）或实时种子（种子），并按 `TARGETS` 的顺序排列。
- **性能：** 每个预设在短文字和长文字上、以及在重度设置下的帧率。
- **测试音轨**（`test-audio/sound-test.wav`，42 秒，16 位立体声，44.1 kHz；由命令生成，不提交到仓库：`npm run test-track` 通过 `scripts/make-test-track.ts` 从 `scripts/test-track.ts` 渲染出它，git 会忽略它；采样和以前提交的文件完全相同）：0–26 秒和以前一样，左右声道相同（0–4 秒只有底鼓，4–8 秒底鼓加踩镲，8–12 秒逐渐变响的和弦，12–15.5 秒静音，15.5–21.5 秒逐渐变弱的完整混音，21.5–26 秒每秒 16 次的踩镲）；26–32 秒是从 A2 到 A5 再回来的单音旋律，用于 Pitch；32–38 秒是每半秒在最左和最右之间切换的踩镲，下面垫着居中的轻柔低音，用于 Pan；38–42 秒是逐渐减弱、左右互不相关的宽噪声（Pan 保持居中）。读数符合预期：前 26 秒和以前一样（只有底鼓时 Beat 约每秒 2 次；Activity 只有底鼓时约 0.38，有踩镲时 0.91–1），Pitch 随旋律为 110、220、440、880 Hz，Pan 每半秒约 ±0.5。
- **浏览器实测：** 用本地测试文件和麦克风测试，不下载任何东西。检查暂停、停止收音或关闭 Drive letters 是否让滑块完全恢复，并检查先 Freeze 再 Export。第 3 阶段（已检查）：用键盘浏览 Target 列表时，在按 Enter 或离开列表之前不会打开任何设置；用指针选择则立即打开。
- **自动测试：** `npm test`（快速测试，CI 也会运行）覆盖合成信号上的特征、Beat 能量门、闪烁限制、映射和目标、用假依赖运行的实时调度器（每秒最多 30 次提交，一次一帧；帧很重时放慢，并在低于每秒 8 帧时说明；一次提交一直没有渲染时一秒后继续；停止时完全恢复；Freeze；只在载入字体时驱动），以及测试音轨每次渲染出同一个文件。`npm run test:slow` 按段读取整段测试音轨，检查上面预期的读数。
- **文档：** README、用户指南和 PRD，中英文分开写。

## 13. 阶段

| 阶段 | 内容 |
|---|---|
| 1 | Sound 标签页；音频引擎（File、Microphone）；特征 Level、三个频带（现在叫 Bass、Mids、Treble）、Brightness，以及带底鼓检测器的 Beat；电平表 |
| 2 | 调制层、连续目标的映射、带独立缓存的自适应实时调度、滑块上的实时值标记、连续映射的闪烁限制、Freeze |
| 3 | 已完成：作为跳变目标、带 Rate 的种子，它们的闪烁限制，以及输入框旁的实时种子；滑块上的 Beat 脉冲；新增 13 个特征，加上立体声测量支路，之后与最初的特征一起合并成五组共 10 个（第 4 节）；紧凑的电平表；自动打开所需设置的目标，带提示和 Enable；42 秒的立体声测试音轨；十个预设，带 Preset 和 Load，Load 会把 Geometry 和 Experimental 的设置恢复为默认值（保留种子）、设好预设的起始值，并说明关闭了什么；为 Flicker 而设的 Distortion 少数锚点模式；File 作为默认来源、没有 Off，Drive letters 改为开关；为重做后的 Experimental 效果新增七个目标（共 43 个），并为它们重新设计 Flare 和 Gale。尚待完成：Step 映射（Allowed directions、Sides、Rings）；实时 SVG 重绘测量 |
| 4 | Pitch 和立体声（Pan）：已在第 3 阶段和其他新特征一起完成 |
| 以后 | 视频录制 |

每个阶段都以第 12 节的验证收尾，并单独交付。
