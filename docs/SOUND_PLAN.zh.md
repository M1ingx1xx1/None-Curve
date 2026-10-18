# 声音计划

[English](SOUND_PLAN.md) · **中文**

**状态：** 第 1 阶段（声音来源、特征、电平表）和第 2 阶段（连续映射、实时调度、实时值标记、闪烁限制、Freeze）已完成。第 3 阶段部分完成（会跳变的种子、10 个特征中的 Pitch 和立体声 Pan、紧凑的电平表、自动打开所需设置的目标、预设，以及重做后的 Experimental 效果的目标和预设）；Step 映射和实时 SVG 重绘测量尚待完成。此后又加入了：Beat 的能量门（第 4 节）、滑块和种子共用一个闪烁预算（第 10 节）、映射在两次访问之间保存并可撤销（第 5 节），以及自动测试（第 12 节）。H 阶段已完成：Response 分组（Strength、Motion contrast、Release、Pitch reactive、Melody tracking，以及 Sensitivity；第 5.1 节）、每个字母按自己的幅度响应（第 5.2 节）、Melody 特征和音高置信度（第 4 节）、Sound 设置的保存与撤销（第 5 节），以及实时视频录制（第 9 节）。H 阶段之后：Sound 驱动字母时文字块保持不动（第 8 节）；Thorn 打开时，它的设置每次只传到少数字母（Thorn 轮换，第 5.3 节）  
**范围：** 在 **Geometry** 和 **Experimental** 旁边新增 **Sound** 标签页。实时声音（本地音频文件或麦克风）驱动两个标签页里已有的参数，让字母随音乐而动：锚点踩着节拍跳动，声音变响时轮廓被揉皱，低音响起时花瓣张开。

## 1. 目标

- 声音**只驱动已有的参数**，包括 Geometry 标签页（Curve flattening、Random anchors、Squaring、Anchors、Grid & angles、Distortion）和 Experimental 标签页（Crumple、Ripple、Whorl、Slipstream、Thorn、Seed）。不新增任何变形操作。
- 两种驱动方式：
  - **连续：** 响度这样的特征让滑块上下移动。
  - **跳变：** 种子前进，于是锚点跳到新位置：每个节拍跳一次，或者某个特征的读数越高跳得越频繁。节拍也可以让一个值换到下一个可选值，例如下一档角度（尚待完成）。
- 实时运行，帧率随设置的计算量自动调整。
- 音频只留在浏览器里：在本地解码和分析，从不上传。
- 关闭 Sound 后，滑块的值完全恢复原样。
- 运动中的字母可以连同声音实时录成视频（第 9 节）。

这取代了之前"由声音驱动的雕刻字形"方向（PRD 第 11 节）。那个方向计划了新的雕刻操作、时间轴、把音频分布到一段文字的各个字母上，以及配方导出；这些都不再做。

## 2. 最高规则：没有曲线

声音只改变参数值，而且只在每个滑块自己的范围内改变，这个范围读自构建该滑块的同一张表（第 8 节；种子：在其输入框范围内的整数）。所以屏幕上的每一个字母都是手动操作滑块和种子输入框也能得到的结果，由同一条流程计算：只保留直边，并且像其他结果一样经过检查。开启 Motion contrast 或 Pitch reactive（第 5.2 节）时，同一帧里的字母可能处在最多三种强度上（quiet、shared 和 strong）。每种强度都有自己的一组值：每个被驱动滑块的实时偏移量按比例缩放，再截断到滑块两端、取整到它的档位，所以每个字母仍然是一组滑块值。Thorn 打开时，字母还分成五个轮换组，每组显示它上一次轮到时取得的、会移动刺的那些设置（Thorn 自己的设置、Experimental 种子，以及第 5.3 节列出的其他设置），所以一帧最多可能显示 15 组值（三种强度乘五个组）；每组仍然是普通的滑块值和种子。Freeze 只写入共享值（第 9 节）。各帧算好一帧就显示一帧。帧与帧之间不做补间或变形过渡，因为那会凭空造出流程从未生成过的中间轮廓。Distortion 的**少数锚点**模式（few anchors）只有 Flicker 预设的 Load 会设置（第 7 节），它和其他设置一样只是设置的一部分：声音从不打开或关闭它。

## 3. 声音来源

- **File**（默认）：浏览器能解码的任何音频文件（WAV、MP3、AAC、OGG、FLAC，取决于浏览器）。有播放、暂停、循环和进度滑块，并通过扬声器播放。
- **Microphone：** 只有用户按下 **Start listening**、浏览器请求权限之后才会开始；选中 **Microphone** 只会显示这个按钮，并暂停文件。不回放，所以不会产生回授（录视频时仍可以把它的声音放进文件，第 9 节）。Stop listening、切换来源和关闭标签页都会释放麦克风，使用期间会显示指示标记。
- 没有 **Off** 来源（最初的版本有，而且是默认）：Pause 停止文件，Stop listening 停止麦克风，选回 **File** 会释放麦克风。
- 无效、空白、静音和不支持的输入各有各的提示信息。麦克风的问题也一样：访问被拒绝、没有麦克风、麦克风打不开（被其他应用占用，或被浏览器中止）、打开了但无法接到分析器上、收音时停止了（被拔出或撤销了访问权限），以及页面不安全。浏览器没有指明的错误读作不支持，而不会读作设备被占用。

## 4. 音频特征

每个动画帧都从 Web Audio 的 `AnalyserNode` 计算特征：44.1 和 48 kHz 下是 2048 点 FFT（88.2 和 96 kHz 下加倍，使分析窗口保持约 43 ms），响度和音高用时域采样计算。分析器前面有一个 20 Hz 高通滤波器，去掉被测量信号里的直流偏移。

**立体声测量支路。** 高通滤波之后，声音还会被上混为正好两个声道（一个按扬声器规则混音的增益节点，所以单声道来源会变成完全相同的左右声道），再拆分开，每个声道由一个分析器测量；Pan 就来自这两个分析器。三个分析器是一个接一个读取的，音频线程可能在两次读取之间渲染（在 Chrome 中最多约 300 帧有一帧）。所以每一帧都会检查混合后的采样是否等于左右声道的平均值，不一致就把三个分析器重新读一遍，最多 3 次；都不一致时，Pan 沿用上一组一致的左右声道。（超过两个声道的来源永远不会一致，所以在保持一帧之后，直接使用读到的数据。）扬声器收到的文件声音和以前一样，麦克风也仍然只被测量，从不播放。

共有 11 个特征，分为五组，在 Sound 标签页中按这个顺序列出（`src/sound/mapping.ts` 中的 `FEATURES`）。除 Pan 外都在 0–1 之间。

| 组 | 特征 | 定义 | 归一化 |
|---|---|---|---|
| Loudness（响度类） | **Level**（响度） | 短时 RMS（去掉直流偏移），单位 dB | −60 dB → 0，0 dB → 1，按 **Sensitivity** 平移 |
| | **Swell**（缓变响度） | 缓慢平滑后的 Level：上升 300 ms，下降 2 s，不受 **Release** 影响 | 同 Level |
| Bands（频带） | **Bass**（低频） | 20–250 Hz 的能量 | 相对于它自己的一个缓慢自适应的滑动最大值 |
| | **Mids**（中频） | 250–2000 Hz 的能量 | 同上 |
| | **Treble**（高频） | 2000 Hz 到奈奎斯特频率的能量 | 同上 |
| Tone（音色） | **Brightness**（亮度） | 20 Hz 到 20 kHz 的频谱质心，按对数频率刻度 | 100 Hz → 0，8 kHz → 1 |
| | **Pitch**（音高） | 在混合后的采样上用 YIN（阈值 0.15）求基频，采样先降到最多 24 kHz。无音高的帧保持上一个音；静音时为 0。 | 55 Hz → 0，1760 Hz → 1，按对数刻度（5 个八度） |
| | **Melody**（旋律） | 每个新音符一个脉冲：音高从它已稳定的那个音移开至少半个半音，并在那里保持 70 ms，而且距上一个音至少 100 ms。已稳定的音缓慢地（400 ms）跟随附近的帧，所以颤音会被平均掉；新音稳定在保持住它的那些帧的平均值上。持续的音、5 到 7 Hz 下约 ±80 音分以内的颤音、噪声、持续音下的八度误判或鼓点，以及静音之后的第一个音（包括滑进这个音的一小段）都不产生脉冲。 | 移动的大小，2 个半音时为满，乘以音高置信度（见下文）；然后按 Release 时间回落 |
| Rhythm（节奏） | **Beat**（节拍） | 由两个基于频谱通量的检测器得出的起音：一个看整个频谱，一个只看 20–150 Hz（底鼓检测器），因为在宽频的声音下，底鼓可能淹没在全频带的通量里。每个检测器在通量超过自适应阈值时触发（最近一秒的中位数 × 一个系数，全频带为 1.5，底鼓频带为 3，再加一个下限，并且至少是上一次起音通量衰减后的一半，所以一次敲击自己的尾巴不会再次触发），两次至少相隔 100 ms。每次底鼓也会触发全频带检测器，所以两个检测器都听到的一次敲击只算一次起音。两个检测器都只在声音能量上升时触发（能量门，见下文），所以持续的声音，包括带嗡嗡声的低音，不会产生节拍。作为特征，它是一个脉冲，取两个检测器的脉冲中较大的那个。 | 每次起音时为 1，然后按 Release 时间回落 |
| | **Activity**（活跃度） | 声音有多忙：取 **Change** 和 **Pace** 中较大的那个，一起平滑。Change 是 Beat 所判断的全频带频谱通量比它最近一秒的中位数高出多少（两次判断之间保持不变）；Pace 是最近 2 秒内每秒的 Beat 起音次数 | Change 相对于最近这种高出量的最大值（一个每 3 秒减半的滑动最大值），但比较的基准从不低于 Beat 的通量下限，也不低于这一帧压缩后频谱总和的四分之一：持续的声音接近 0，纯音和噪声都一样，起音处很高。Pace：每秒 8 次 → 1 |
| Stereo（立体声） | **Pan**（声像） | 左右声道 RMS（去掉直流偏移）的 (R − L) / (R + L) | −1（左）到 1（右）：唯一的双向特征 |

实际上 Pan 需要立体声文件：单声道文件或单声道麦克风读作居中。

**由 20 个合并而来。** 第 3 阶段最初测量 20 个特征，分为六组，后来合并成这 10 个：Low、Mid、High 改名为 Bass、Mids、Treble；六个窄频带（Sub、Bass、Low mid、High mid、Presence、Air）、Noisiness（噪声度）和立体声的 Width（宽度）被去掉；Kick（底鼓）变成 Beat 的第二个检测器；Change 和 Pace 合成 Activity，取两者中较大的那个而不是平均值，因为平均值会让范围减半，永远到不了 1；Balance 改名为 Pan。H 阶段又加入了第 11 个特征 Melody。

- **Release（释放）**（H 阶段之前叫 Smoothing；滑块的 id 现在是 `sound-release`）：每个连续特征都以快速的起音（10 ms，固定）和较慢的释放（默认 150 ms，20–1000 ms，步长 1，由 **Release** 设置）跟随声音，所以字母立即响应，但不会闪烁。有些特征用自己的时间常数：Swell（见上表）；Pitch 上下都用 30 ms，静音时按释放时间降到 0；Pan 上下都按释放时间变化；Beat 和 Melody 跳起后按释放时间回落。
- **音高置信度**（帧里的 `pitchConfidence`）：Pitch 读数有多可靠，0–1。清晰的单个音符时高，噪声或很轻的音时低，无音高或静音时为 0；按起音时间上升，按 Release 回落。它不是特征：没有电平表，也不能被映射。Melody 按它缩放；Pitch reactive 也需要清晰的音符（第 5.2 节）。
- **旋律音域**（帧里的 `pitchLow` 和 `pitchHigh`；`features.ts` 中的 `followRange` 和 `melodyRange`）：Pitch reactive 放置音高的范围（第 5.2 节），在 Pitch 的 0–1 刻度上，从 Melody 近来稳定下来的最低音符到最高音符。它一开始是围绕第一个稳定下来的音符的一个八度；新的最低或最高音符以 150 ms 的时间常数（`melodyRangeAttackMs`）把它撑开；两端以 8 秒（`melodyRangeReleaseMs`）向正在听到的音符（两个音符之间则是上一个）收拢；距上一个音符超过 8 秒的第一个音符让它重新开始。它在所含音符周围始终至少 12 个半音宽（`melodyRangeMinSt`），并保持在 0–1 之内，所以平稳的人声不会随每次晃动扫过整段文字。不计入的有：重新开始后仍在稳定中的音符（滑进来的音）、Melody 离开其稳定音符的那些帧（鼓击、八度误判、颤音），以及距 Pitch 刻度两端一个半音以内的音符，和弦或完整混音会读在那里（约 55 Hz，置信度很高）。在任何音符之前它是 0 到 1，即 Pitch 的全部（与 `SILENT_FRAME` 相同）。和置信度一样，它不是特征。
- **Melody 的已知限制：** 4.5 Hz、±80 音分的颤音在 120 fps 下仍会产生约 5 个脉冲；带 ±80 音分颤音的人声旋律会漏掉一些换音；150 ms 长的音符，5 次换音只能抓到 3 到 4 次，200 ms 的音符全部抓到。
- **静音门限：** 低于静音阈值时，连续特征降到 0，也不会触发节拍。即使另一个频带很响，自身能量低于静音阈值的频带也读作 0。Swell 按自己的 2 秒回落，Activity 里的 Pace 则随着最后几个节拍离开它的 2 秒窗口而回落。
- **Sensitivity** 也会缩放起音通量所比较的幅度，即 ln(1 + 1000 g m)，其中 g = 10^(Sensitivity / 20)，所以它同样作用于 Beat。这与最初规格里的公式 ln(1 + 1000 m) 不同：按那个公式，Sensitivity 帮不了小声来源的起音检测。
- 起音每秒最多判断约 60 次，所以在 120 Hz 及更高刷新率的屏幕上，阈值的含义也相同。
- **Beat 的能量门**（`SOUND_LIMITS` 里的 `onsetRiseDb` 及其后几项）：持续的、谐波丰富的低音（锯齿波、方波或约 140 Hz 以下的嗡嗡低音）会骗过通量：分析器的窗口跨过相邻的谐波，每个频点以某个频率起伏，被帧率混叠成每秒几次到 19 次的起伏，而通量的中位数仍接近 0。这样的音会让 Beat 每秒触发 5–11 次，其上的底鼓也有一半淹没在误触发里。所以只有当某个倍频程频带比它最近 100 ms 内的最高值上升至少 2 dB 时，检测器才会触发。频带从 20 Hz 开始（20–40、40–80 Hz，依此类推，最后一个一直到奈奎斯特频率）；底鼓检测器只看起点低于 150 Hz 的频带。频带能量以加上 Sensitivity 之后的 dB 计，且不低于静音阈值。一个频带之前的能量，在它此后下降超过 12 dB 时就不再计入：两次敲击之间声音已经消退，所以和第一次一样响的第二次敲击仍算新的起音（没有这一条时，每秒 12 次的踩镲从每秒 6.9 个节拍降到 1.2 个）。测得：持续的锯齿波低音最多上升 2.0 dB，敲击至少 2.3 dB，多数在 5 dB 以上；持续的嗡嗡声最多下降 9.4 dB，而每秒 10 次的敲击之间会下降 14–27 dB。已知限制：被同一倍频程里更响的声音掩盖的敲击（比低音音符弱 12 dB 的底鼓）会漏掉；在完整的锯齿波低音下，也会有一些真正的底鼓被拦下。
- 处理分母为零的情况，并截断离群值。

## 5. 映射

一个映射把一个特征连接到一个目标参数。Sound 标签页最多容纳 8 个映射，每个都有开关。11 个特征中的任何一个都可以驱动任何目标；效果取决于目标的类型。

- **滑块目标**（任意特征 → 一个滑块）：
  - 实时位置 = 滑块位置 + **Depth** × 特征，截断到滑块两端，再取整到滑块的档位。位置沿滑块的绘制方向计算（0–1），所以普通滑块相当于 滑块值 + Depth × 特征 × 滑块的全部范围，而非线性的滑块（对数刻度的 Tolerance、三次方刻度的 Thorn · Reach）沿滑道均匀移动。
  - Depth 从 −100% 到 100%。Depth 为负时，声音越响，值越小。Pan 的范围是 −1 到 1，所以它让滑块双向移动：声音偏左时往一边，偏右时往另一边。
  - Beat 是脉冲，所以用在滑块上时，值在每次起音时按 Depth 跃起，再在 Release 时间内回落到滑块值。Melody 在每个新音符上也一样。
  - Response 分组的 Strength 和 Melody tracking 作用在这个总和上（第 5.1 节）；Motion contrast 和 Pitch reactive 随后按字母起作用（第 5.2 节）。
- **种子目标**（跳变）：Distortion · Seed、Random anchors · Seed 和 Experimental 的 Seed。换一个新种子，每个锚点就落到新的地方，所以种子每跳变一次就前进一个。该行的 Depth 旋钮改为 **Rate**（频率，0–100%）：
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
- **拖拽映射**（NOCUR-75），与 Ableton 或 Bitwig 一样：从 Input 框里某个特征的电平表拖出这个特征，放到任意标签页里作为目标的控件上（§6）：Geometry 和 Experimental 的滑块、种子和勾选框，Typography 的滑块，颜色（它的 Hue 或 Lightness），以及可变轴。放下后添加一行，处于打开状态，Depth 为 +50%（种子的 Rate 为 50%；开关从 Toggle 开始），并完全像 Add mapping 一样打开目标需要的设置，显示同样的提示；这一行和它打开的设置是一个撤销步骤。同一个特征已经映射到这个目标时不会再映射一次，而是标记已有的那一行；那一行如果是关闭的，会把它和目标需要的设置一起打开，作为一个撤销步骤。已有 8 行时不添加。语义不变：拖拽添加的行就是普通的行。
- **基准值保持不变：**
  - 滑块保留自己的值，Sound 实时运行时滑块不动；每个被驱动的滑块上有一条细标记显示实时值。
  - 种子输入框保留自己的种子；旁边一个小数字显示实时种子。Distortion 和 Random anchors 的统计数字也显示实时种子，因为它们描述的是屏幕上显示的字母。
  - Depth 或 Rate 为 0，或映射关闭时，得到的就是滑块值或种子本身。
  - 映射到步骤、效果或模式未打开的目标时不起作用，该行会注明。
  - 没有载入字体时没有字母可动，所以 Sound 不驱动：什么都不变，标记和实时种子保持隐藏，状态栏不显示 Live，种子也不跳变。载入字体后才开始驱动；Sound 驱动时字体没了，滑块和种子会完全恢复。
- **和设置一起保存与撤销：**
  - 映射和 Response 的七个值（Sensitivity、Strength、Motion contrast、Release、Pitch reactive、Melody tracking、Glide；第 5.1 节）和设置一起保存在浏览器里，下次打开时恢复。Drive letters 不保存：它开始时是打开的，开启减少动态效果时则是关闭的（第 10 节）。来源和录制选项（第 9 节）也不保存。
  - 添加或删除一行，改变它的 Feature、Target 或开关，拖动一次 Depth 或 Rate（每次拖动一步），拖动一次七个声音旋钮中的任一个（每次拖动一步），Reset sound，选择目标连同它打开的设置，Load，以及 Freeze，各是一个撤销步骤，和设置共用同一段历史。撤销和重做也会清掉上一次 Load 或所选目标的提示，因为它们已不再描述当前状态。实时帧从不进入历史。

### 5.1 响应控件

Response 设置决定字母如何回应声音，作用于所有映射。它的七个旋钮（Sensitivity 和 Release 在 Input 框里，其余四个在 Response 框里）：

| 控件 | 范围、步长 | 默认值 | 作用 |
|---|---|---|---|
| **Sensitivity** | −24 到 +24 dB，1 dB | 0 dB | 测量前对输入的增益（第 4 节） |
| **Strength** | 0–400%，1% | 100% | 在截断之前，把每个滑块目标的偏移总和乘上它，所以 200% 让字母移动两倍远，直到滑块尽头。它也乘上每个种子的 Rate，Rate 仍以 100% 为上限。为 0% 时 Sound 停止驱动，和 Pause 一样：完全恢复，种子回到输入框的值，不显示标记，Mappings 分组显示 "Strength is 0%: the letters hold still." |
| **Motion contrast** | 0–100%，1% | 0% | 每个字母按自己的幅度响应（第 5.2 节） |
| **Release** | 20–1000 ms，1 ms | 150 ms | 读数回落得多慢（第 4 节） |
| **Pitch reactive** | 0–200%，1% | 0% | 近来旋律中的低音让左边的字母动得更多，高音让右边的字母动得更多；需要清晰的单个音符（第 5.2 节） |
| **Melody tracking** | 0–200%，1% | 0% | 给每个滑块映射的特征加上 0.5 × Melody tracking × Melody 脉冲（上限为 1），Pan 行和读 Melody 的行除外。种子不受影响。所以即使响度不变，字母也会在每个新音符上动起来。 |
| **Glide** | 0–1000 ms，10 ms | 150 ms | 只影响显示（第 5.4 节）：每个新的实时形状在这段时间内到达，而不是立刻出现。默认值不是中性值，但它不改变任何计算出的形状，所以固定的哈希不变；`NEUTRAL_RESPONSE` 保持 0 ms，`DEFAULT_RESPONSE` 是中性值加上 150 ms。 |

- 默认值是中性的：Sound 的表现和 H 阶段之前完全一样，所以已保存的会话和预设看起来不变；只有 Thorn 打开时例外：它的设置现在按轮换传到字母（第 5.3 节），这有意改变了 Flare 的实时帧。`tests/sound/neutral.test.ts` 对照 4a54e5d 锁定了这一点，其调度器哈希不含 Flare（第 12 节）。
- `ResponseSettings`、`RESPONSE_LIMITS` 和 `NEUTRAL_RESPONSE` 在 `src/sound/types.ts` 中；Strength 和 Melody tracking 在 `modulate` 和 `JumpTracker.advance` 中生效，Motion contrast 和 Pitch reactive 在 `src/sound/letters.ts` 和调度器中生效。
- **保存：** 会话保存全部七个值（`Session.sound`）。读取时，每个值必须是有限的数字，会被截断到它的范围并取整到它的步长，否则读作默认值。H 阶段之前保存的会话读到的是默认值；会话版本号不变。
- **撤销：** 每次拖动是一步（撤销键为 `sound:` 加字段名）；Reset sound 用一步把七个值都恢复为默认，已经是默认值时它不可用。
- 预设的 Load 不动这七个值（第 7 节）。

### 5.2 逐字母响应

Motion contrast 和 Pitch reactive 作用于每个字母，即文字里每一次出现的字形，而不是作用于映射（`src/sound/letters.ts`）。

- **字母**（`letterSlots`）：每一次出现占一个位置，顺序和画布排布它们的顺序相同（先按行，再按字形；空格和缺失的字形也计数）。每个位置记录它的字形 id、它在文字块中横向所处的位置，以及它在文字中所占的份额（它的步进宽度除以所有要绘制字母的步进宽度之和）。空格和缺失的字形始终显示共享级别。
- **权重：** 每一帧，每个要绘制的字母得到一个权重，即它的 Motion contrast 增益乘以它的 Pitch reactive 权重。两者在 0% 时都恰好为 1。
  - **Motion contrast** 是均衡的：在 100% 时，字母的增益从 1/3.6 到 3.6，在对数空间里围绕 1 均匀分布（设置为 c 时是 3.6^±c）。每个字母的增益混合了一份固定属于它自己的成分（38%，来自它在文字中位置的哈希值）和一个缓慢的波（6 秒，每个字母相位不同），所以领头的字母每隔几秒就会换一批。在 100% 时约 17% 的字母是 quiet、67% 是 shared、17% 是 strong：整体幅度由 Strength 决定，Motion contrast 决定分散程度。
  - **Pitch reactive：** 近来旋律中的低音让左边的字母权重更大，高音让右边的字母权重更大。每个字母的权重是围绕音高在文字块中横向位置的一个钟形（`pitchWeight`），这个位置就是音高在旋律音域中所处的位置（`pitchPlace`，`pitchLow` 到 `pitchHigh`，第 4 节），所以无论曲调在哪个音区，都会扫过整段文字。旋律第一次上行时，每个新的最高音符都落在最右端，因为音域随它一起扩展；音域听过一遍之后，每个音符都有自己的位置。它需要清晰的单个音符，例如人声或单件乐器。
    - **为什么用旋律音域：** 在 Pitch 的整个 55–1760 Hz 刻度上，一个八度只占文字的五分之一，所以普通的旋律几乎移不动 strong 级别的字母：C4 和 C5 之间的跳进让它们的平均位置（0 是文字左端，1 是右端）落在 0.46 和 0.62，而在旋律音域中是 0.15 和 0.82。
    - **已知限制：** 在 200% 时，快速的八度跳进偶尔会被闪烁限制拦下（第 10 节）：C4 和 C5 交替、每秒 2 个音符时，11 次跳进中有 10 次到位，100% 时 11 次全部到位。
- **三个级别：** 权重被分成三个级别：quiet、shared（1）和 strong。它们的增益按设置固定（不随时间或声音变化），所以没有 Thorn 轮换（第 5.3 节）时一帧最多需要三组参数，而持续的声音只会让字母在已经算好的参数组之间移动。只开 Motion contrast 100% 时，增益是 1/3.6、1 和 3.6；有 Pitch reactive 时，quiet 和 strong 的增益也会变化，但不超出固定的界限。分界线在对数空间里位于 1 与各级别增益的正中间。
- **滞后：** 要离开当前级别，字母的权重必须越过分界线，超出分界线到 1 的距离（对数空间）的 15%，所以在分界线附近摇摆的字母会留在原处。
- **级别的值**（`levelPosition`、`levelSets`）：共享值，其中每个被驱动滑块相对于滑块自身位置的偏移量按该级别的增益缩放，再截断到滑块两端、取整到它的档位；结果如果仍在滑块值自己的那一档内，就保留滑块的精确值，和 `modulate` 的做法一样。所以每个级别都是滑块能给出的一组值（第 2 节）。它随共享位置单调变化：只有共享值折返时，级别才会折返（第 10 节）。种子、闪烁限制保持住的值，以及 Thorn 推算出的画布 em，都随共享值一起带过来。Thorn 自己的滑块从不缩放；Thorn 打开时，其他轮换目标也不缩放（第 5.3 节）：字母从自己的轮换组取得它们，所以这时级别只缩放 Distortion 的滑块，以及 Crumple 和 Ripple 的 Amount。这也消除了 strong 字母过长的刺：Reach 是三次方滑块，缩放位置曾让 strong 字母的长度最多达到共享值的约 47 倍。因为缩放的是偏移量，往下走的滑块（Depth 为负，或 Pan 偏向某一边）在每个级别上都往下走。
- **合并：** 值与共享值相同的级别（例如在粗档位的滑块上，缩放后的偏移量仍在同一档内）就是共享级别，它的字母使用共享的结果。没有任何字母离开共享级别（有 Thorn 轮换时，还要每个组都显示实时的 Thorn 设置，第 5.3 节）的一帧，不会额外请求任何东西。
- **种子保持全局：** 所有字母共用实时种子；只有 Thorn 打开时，会移动刺的种子（Experimental 种子和 Random anchors 的种子）才按轮换组逐组传到字母（第 5.3 节），Distortion 的种子仍然共用。一次跳变让所有字母同时变化，所以各级别不会为种子另外产生闪烁边沿，Freeze 也能写入种子。Strength 缩放 Rate；Motion contrast 和 Pitch reactive 不影响种子。
- **面板显示的是共享级别：** 标记、实时种子、状态栏的描述以及所选字形的统计数字都显示共享值，Freeze 写入的也是它们（第 9 节）。之后每个字母都取共享的形状，这个形状已经算好，所以切换是即时的；有 Thorn 轮换时，这只对所在组显示实时 Thorn 设置的字母成立，其他字母的字形那时才计算（第 5.3 节）。
- **文字与排版：** 字母数量变了（编辑了文字）时，级别重新开始，第一次分配不算闪烁边沿。同样的文字换了排版（字距、行高、对齐、倾斜）时，每个字母保留自己的级别。
- **已知限制：** 在粗档位的滑块上（Ripple · Sides、Whorl · Rings 和 Sides、Curve flattening · Segments per curve；指 Thorn 关闭时，因为 Thorn 打开时级别不缩放它们），只有共享值离开了原来那一档之后，quiet 和 strong 的字母才会分开。
- **开销：** 一帧最多请求三组参数（有 Thorn 轮换时，字母最多用 15 组，另加共享参数，第 5.3 节），所以 Motion contrast 和 Pitch reactive 可能降低帧率（第 8 节）。

### 5.3 Thorn 轮换

Sound 驱动字母且 Thorn 打开时，会移动刺的设置每次只传到少数字母：同一时刻最多约五分之一字母的刺在变，每个字母的刺最多每 1.25 s 变一次（`src/sound/types.ts` 中的 `THORN_TURNS = { groups: 5, gapMs: 250 }`；`src/sound/letters.ts` 中的 `turnGroups` 和 `ThornTurns`，由 `live.ts` 中的调度器驱动）。以前，Seed 上的一个节拍会让每个字母的刺同时重新挑选；Thorn 又是在每次变形之后的轮廓上挑锚点，所以上游任何细小的移动几乎每一帧都会重新挑选几乎所有的刺。现在 Thorn 在 Distortion 之前的字母上挑锚点，并把它们一路跟随过各次变形（EXPERIMENTAL_PLAN 第 4.8 节），剩下的变化由轮换来控制节奏。

- **轮换目标**（`isTurnTarget`）：Thorn 打开时，除 Distortion 的滑块和种子以及 Crumple 和 Ripple 的 Amount 之外的所有目标。也就是 Thorn 自己的滑块、Experimental 种子（Crumple 和 Slipstream 共用它，所以它们也按轮换换种子）、Distortion 之前的每个 Geometry 步骤（Thorn 在它们做出的字母上挑锚点，包括 Random anchors 的种子），以及 Crumple、Ripple、Whorl 和 Slipstream 的其他所有滑块。刺在 Distortion 以及 Crumple 和 Ripple 的 Amount 变化时保持自己的锚点和方向，所以这几项仍然连续变化、所有字母共用，和 Thorn 关闭时一样。Thorn 推算出的画布 em 不是轮换目标：它立即跟随画布。
- **分组**（`turnGroups`）：要绘制的字母分成 5 个轮换组，每组由完整的字形 id 组成，所以同一字形的每次出现一起轮换，一个组也不会把同一字形算两次。各组按字母数平衡，每组最多 ceil(N / 5) 个字母：字形从出现次数最多的开始（次数相同时按字形 id 的哈希排序），放进剩余空间最大的组，所以每组的字母散布在整段文字里，而不是按阅读顺序一段一段扫过去。只有整个放不进任何一组的字形，才按出现位置拆开，分到尽量少的组里。要绘制的字母少于五个时，有些组是空的。同样的字母换了排版，分组不变。
- **一次轮换：** 每个字母显示自己级别的值（第 5.2 节），再配上它所在组上一次轮到时取得的轮换状态。一次轮换把当前的实时轮换状态交给下一个组（依次循环），条件是上一次轮换已经显示到屏幕上，并且从那时起已过了 250 ms。这个组在自己的状态与实时状态不同时接受它：种子或刺的数量不同、某个滑块相差至少半个闪烁摆幅（行程的 5%），或者声音已把某个滑块放回它自己的值而该组还没有（这样安静下来时正好回到滑块上）。只要另有组不同，没有不同、或者没有字母的组就会让出这一轮：这一轮照样过去 250 ms，什么也不变，所以后面的组不用等它；所以即使文字很短，每个字母也最多每 5 × 250 ms 轮换一次。
- **级别不缩放它们：** Thorn 打开时，Motion contrast 和 Pitch reactive 让每个轮换目标保持该组的值；它们仍然缩放 Distortion 的滑块，以及 Crumple 和 Ripple 的 Amount（第 5.2 节）。
- **闪烁限制：** 一次轮换本身算一次变化，从同一个预算中支取（第 10 节）。它的大小是该组在文字中的份额乘以它的轮换目标的滑块移动了多远（以滑块行程计），换一个新种子算一整个行程；达到 10% 及以上的轮换支取一个边沿。预算拒绝的轮换会等待：该组保持原状态，下一次更新时再申请。
- **重新开始：** 以下情况下，所有组立即取得实时状态，不算轮换，也不支取预算：Sound 开始驱动时（Play、Start listening、Drive letters，任何一次停止之后）、打开 Thorn（Use thorn）时，以及字母变化时（编辑文字，或换了会改变字形的字体或大小写；同样的文字换了排版则保留分组）。添加或删除一条映射不会重新开始：它带来的变化按轮换逐组传到字母。用手移动一个声音没有驱动的滑块，会立即传到所有组，和没有 Sound 时一样。
- **仍然共用的：** 实时值标记、实时种子、状态栏、所选字形的统计和 Freeze 都按共享的实时值，而不是某个组的值（第 9 节）。
- **Thorn 关闭时**，没有任何东西按轮换：调度器的请求、提交和 Freeze 与 Thorn 轮换之前完全一样（第 12 节）。
- **每个字母仍然是滑块和种子输入框能得到的结果：** 一个组的状态是滑块和种子曾经有过的一组实时值，字母的级别照第 5.2 节施加在上面。
- **开销：** 一帧的字母对每个级别和每个组最多显示一组参数，总共 15 组，和共享参数一起放在一次请求里（第 8 节）。因为每组由完整的字形 id 组成，每组参数只为显示它的字母的字形计算，共享参数也只为显示共享值的字母的字形（以及所选字形，为了它的统计）计算，所以没有级别时每个字形每帧大约只算一次，和以前一样。

### 5.4 Glide（NOCUR-74）

- **是什么：** 在实时形状之间做显示时的补间。实时调度、它的缓存、闪烁限制、标记、状态、Freeze 和导出都看不到它；只有画布、预览和录制绘制中间场景。`SceneGlide`（`src/specimen/glide.ts`）是纯的，时钟由外部传入；`GlideStore` 和 `useSceneGlide`（`src/state/useGlide.ts`）在 `requestAnimationFrame` 上运行它，没有东西在动时停止循环；`<Glided>`（`src/components/Glided.tsx`）每帧只重新渲染这三个视图。
- **何时：** 声音驱动字母时（`useLiveDriving`），以及停止时显示的那个场景再滑一次。字体或文字改变（字形序列不同）时立刻显示。Glide 为 0 或 `prefers-reduced-motion` 时每个场景都立刻显示，和以前完全一样。缓动是 Glide 时长内的三次缓出；滑行途中到来的形状从屏幕上的样子开始，已完成至少 99% 的滑行（`GLIDE_LIMITS.arrived`）算作已到达。
- **对应关系**（`src/specimen/morph.ts`）：闭合路径按质心距离除以尺寸、再加上面积之比的对数贪心配对，外轮廓配外轮廓，孔配孔（超过 48 条路径时只尝试最近的 4 条）；相距超过两者尺寸之和一半、或面积相差 4 倍以上的不配对。两边轮廓绕向相反时（按最大的路径判断；Whorl 的 Amount 大于 1 时合并后的绕向相反），先把新轮廓的路径倒过来。没有配对的路径，如果另一边轮廓（所有路径）上的最近点平均在它的尺寸之内，就从这些点长出或缩回到这些点，否则从质心长出或缩回质心。锚点数相同且移动很小（≤ 0.35 × 尺寸，取移动最少的起点错位）时逐点对应；否则把两边锚点的并集按最近点对应到另一条路径上并保持顺序：先找出每个锚点的最近点，保留保持顺序的最长一串（从第一个锚点的最近点开始），其余的按弧长放在前后邻居之间。两端精确：进度 0 和 1 返回旧轮廓和新轮廓本身。只有旧轮廓才有的锚点，若离一段直线不到 0.004 em 就去掉；数量多于新轮廓锚点时，容差逐步加倍，最多到 0.05 em，尺寸或厚度在容差以内的多余路径也去掉，所以多次滑行不会让锚点越积越多。中间形状超过 12,000 个点时立刻切换。
- **轨迹**（`src/specimen/trajectory.ts`、`whorlGlide.ts`）：刺和 Whorl 以外的所有效果都走直线（从根部笔直长出、笔直缩回）；Whorl 沿由直线组成的路径卷过去。worker 给出的 `PolygonGlyph.motion.whorl` 包含中心、边数、环数、半径、每个环转过的角度、进入 Whorl 之前的轮廓，以及 Whorl 是否是最后一个改变字形的效果。只有 Whorl 的转动改变且它是最后一个时，滑行就是 Whorl 的网格转过一部分：进入 Whorl 之前的轮廓在网格的折线处切开，每个点保留它所在三角形的重心坐标，网格的每个角用 `along` 沿它的环形多边形移动（从多边形的一个角到下一个角分段直线，每段内角度均匀），滑行途中接着走时从屏幕上的角出发；折叠处和最外环以外的区域都完全跟随。其他情况下，只要 Whorl 的设置变了，锚点就在精确撤销 Whorl 转动之后的轮廓上配对（每个网格三角形的逆变换；字母折叠处取离进入 Whorl 之前的轮廓最近的那一层），每个锚点按 Whorl 在它根部（它在配对轮廓上的位置）所在大小处的转动变化量沿多边形转过去，剩下的位移按直线加上，所以 Whorl 之后的效果相对于根部仍走直线。Sides 改变时两个多边形在中途衔接。有自己路径的新效果添加一个 `TrajectoryModel`，并把数据加到 `GlyphMotion`。
- **开销：** 配对在主线程上进行，每个动画帧最多 6 ms（`GLIDE_LIMITS.planBudgetMs`），从上一帧停下的地方轮流进行，每帧至少一个字形，所以没有字形会一直等下去；还没配对的字形保持屏幕上的形状，配对后开始完整的滑行。配对结果按新旧轮廓缓存（WeakMap），重复的字母每帧共用一个中间形状。在 54 个字形、每 33 ms 一个新形状的情况下测得：重新定目标 0.1–0.5 ms；含配对的帧平均 6–7 ms，只插值的帧 0.1–1.3 ms；单个很大的 Dissolve 字形偶尔一次可达约 50 ms。每个字形（Roboto，Node）：Whorl 网格滑行配对 0.1–0.3 ms、每帧约 11 µs；Whorl 加 Thorn 3 ms、27 µs；Burst 种子 0.8 ms、7 µs；Dissolve 颗粒 4.9 ms、58 µs。
- **保存：** `glideMs` 属于 `Session.sound`；没有它的会话读作 150 ms。由 `tests/specimen/glide.test.ts`（两端精确、刺走直线、按最近点保持顺序的对应、错开的起点、相反的绕向、分裂的路径从轮廓长出、逐步去掉多余锚点、Whorl 路径分段为直线、精确撤销转动、网格滑行跟随 Whorl 且接着走时不跳、孔的配对、重新定目标时连续、Glide 为 0 和没有声音时完全相同、时间预算及其公平）和 `tests/state/persist.test.ts` 检查。

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

以下也是目标，但没有建议的驱动方式：Curve flattening 的 Segments per curve 和 Corner angle，以及 Distortion 的 Normal bias。完整列表按面板顺序见 `src/sound/mapping.ts` 中的 `TARGETS`（README 的“目标”一节）：共 42 个目标，其中三个种子是跳变目标，其余都是滑块。Allowed directions 会随 Step 映射成为目标。

**Experimental 标签页**：Crumple 的 Amount / Facet size / Turn；Ripple 的 Amount / Wavelength / Sides / Center X / Center Y / Fade / Petals；Whorl 的 Amount / Rings / Sides；Slipstream 的 Direction / Strength / Slip / Gust size / Gustiness / Cuts / Trails；Thorn 的 Anchors / Reach / Root / Spread / Width / Refraction / Flute width（Reach 是画布对角线的比例，沿面板上的三次方滑块移动）；以及共用的 **Seed**（Beat，Rate 100%），因为它的分组在标签页最下方，所以排在最后。Target 列表里它只显示为 "Seed"；其他目标都显示为 "Section · Label"，例如 "Distortion · Seed"。旧的保存设置里缺少的字段按面板显示的值读取：Thorn 的 Root 为 50%、Flute width 为 10%，Crumple 的 Turn、Ripple 的 Petals、Slipstream 的 Slip、Cuts、Trails 和 Thorn 的 Refraction 为 0。Crumple 带 Detail 时（第 9 阶段起，到 NOCUR-60 为止）保存的设置，读取时忽略这个值，并丢弃 Crumple · Detail 上的映射行。Reach 还是 em 比例时保存的 Thorn · Reach 映射行保留它们的 Depth，现在它移动的是三次方滑块。

**滑块之外（NOCUR-73）**：效果的开关（每个 Use …、Ripple 的 Reverse、Thorn 的 Burst 和 Reverse：0/1，只有 Trigger 或 Toggle，没有 Depth、Range 和 Curve，先于其他目标应用，所以把 Thorn 打开的行能让 Thorn 的滑块行以及 Burst、Reverse 开关行在同一帧起作用）；Typography 的 Size / Tracking / Line height / Slant（范围与 Typography 标签页相同）；文字颜色和背景颜色的 Hue（0–360°，两端截止，不绕回）和 Lightness（0–1），在 OKLCH 中移动并保持彩度；以及所载入可变字体每个轴一个目标（`axis.<tag>`），从字体自己的值出发在轴上移动。字体没有的轴上的行会保留、保存，但不起作用。排版和颜色作为提交中的 `look` 到达画布，从不按字母级别缩放；除了 Thorn 自己的开关，这些目标都不按 Thorn 轮次变化。轴的值通过字体的实例（`LoadedFont.at`，带缓存）进入字形，只有与字体自己的值不同时才加入几何键。没有映射它们时，每一帧和每个键都和以前一样（README 的“更多目标”）。

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

1. 把 Geometry 和 Experimental 的每个设置都恢复为默认值（Curve flattening、Random anchors、Squaring、Anchors、Grid & angles、Distortion，以及每个 Experimental 效果），但保留三个种子（Distortion、Random anchors 和 Experimental 的种子）。Typography、Color、画布，以及 Sound 标签页的来源、Drive letters 和 Response 分组（第 5.1 节）都不动。
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
| **Flare** | Beat → Seed（Rate 100%）；Level → Thorn · Reach（50%）；Beat → Thorn · Anchors（15%） | Thorn 打开，Anchors 1，Reach 0%，Root 25% | Thorn | 越响，每个字母就有几个锚点射出刺；每个节拍它们都跳到新的地方，并短暂变多 |
| **Gale** | Level → Slipstream · Slip（50%）；Beat → Slipstream · Cuts（40%）；Activity → Slipstream · Trails（35%） | Slipstream 打开，Strength 0%，Slip 0% em，Cuts 0，Trails 0 | Slipstream | 响度让字母的切片彼此错开；节拍顺着气流切出细缝，繁忙的段落拖出拖尾 |

- **Flicker** 打开 Distortion 的**少数锚点**模式。它没有自己的控件，也不是 Sound 的目标：只有这个预设会设置它，Reset distortion 或载入另一个预设会把它关掉。每个字母只有 1–5 个锚点移动，拐角和最外侧的点从不移动，每个移动的锚点至少移动幅度的 60%，换一个种子就换一组锚点（见 README 的“顶点扰动”和 PRD 的 P1）。很小的幅度 2 让 Distortion 保持打开，所以安静时 Seed 那一行也起作用。
- **Jitter** 的幅度 2 同理，让它的 Noise frequency 那一行在安静时也起作用。
- **Low poly** 合并相连的曲线，所以较大的 Tolerance 能作用到整个碗形（不合并时，字体里的每段曲线至少保留一条边）。**Facet** 也合并曲线，所以它的段数按合并后的曲线（四分之一个碗形）计算，而不是按字体里的每段曲线计算。
- **Flare** 从 Reach 0 开始，所以安静时没有刺，也没有根部的拉动；Root 设为 25%（默认值的一半），让笔画保持可读。音量最大时，它的 Reach 映射行把三次方滑块推到一半，即画布对角线的八分之一（在默认画布上约 3.8 em）；Reach 还是 em 比例时这一行是 30%。Thorn 一开始就打开，所以它的 Seed 那一行不需要再打开任何设置，Crumple 也保持关闭。它的映射行在 Thorn 轮换（第 5.3 节）之后没有改，由轮换来控制节奏：节拍带来的新种子和刺的数量，以及更响时的 Reach，每次只传到约五分之一的字母，每个字母最多每 1.25 s 变一次，而不是所有字母同时变。
- **Gale** 开始时 Strength、Slip、Cuts、Trails 都为 0，所以安静时什么都不会被气流带动。它从不驱动 Strength：拉伸会把字母推到相邻的字母上。
- **Bloom** 的 Petals 那一行只在 0% 和 10% 之间切换，低音一起来就到 10%（滑块的档位是 10%，而 20% 很难看清）。
- **第 3 阶段重新调过：** 特征合并时，用 Kick 的行改用 Beat（Block、Facet、Bloom 的 Depth 也调小了），Low poly 的 Noisiness 那一行改为 Brightness，Pixel 和 Jitter 改读 Bass 和 Treble。Experimental 效果重做后，Flare 和 Gale 按 Thorn 和 Slipstream 重新设计。每个预设都在 Arial 和 Georgia 上，在静音、完整混音、节拍峰值和最大响度下看过：字母都保持可读。

## 8. 架构与性能

- **新代码放在 `src/sound/`：**
  - `types.ts`：共用的类型、上下限和静音特征帧；响应设置（`ResponseSettings`、`RESPONSE_LIMITS`、`NEUTRAL_RESPONSE`、`clampResponse`，第 5.1 节）。
  - `engine.ts`：Web Audio 音频图及其来源，包括立体声测量支路（第 4 节），以及录制用的分接（`startRecordingAudio`、`stopRecordingAudio`，第 9 节）。
  - `useSound.ts`：访问音频引擎及其帧的 React hook。
  - `features.ts`：从频谱、采样以及左右声道中提取特征，包括音高置信度和 Melody（无需音频即可测试）。
  - `mapping.ts`：特征列表（`FEATURES`，分五组）、目标列表（滑块和种子，每个都带有它起作用所需的设置，以及打开这些设置的修改 `activate`），以及 滑块值 + 特征 + 映射 + 跳变 + 响应设置 → 实时参数（`modulate`，纯函数；Strength 和 Melody tracking 在这里生效）。每个滑块目标的范围和档位都取自 `src/state/sliderScales.ts`（`SLIDER_RANGES`，按目标 id 索引；对数刻度的 Tolerance 滑块用 `TOLERANCE`，三次方刻度的 Thorn Reach 滑块用 `THORN_REACH`），面板也用同一张表构建滑块，所以实时值总是滑块自己能给出的值，两边不会不一致。
  - `flash.ts`：闪烁限制的共用预算（`FlashBudget`、`FLASH_LIMITS`，第 10 节），被驱动的滑块和种子的跳变都从中支取（纯逻辑）。
  - `jumps.ts`：`JumpTracker`，根据测量到的帧累计每个被驱动种子的跳变（每个 Rate 都乘以 Strength），每个跳变帧都从闪烁预算中支取；以及 `JUMP_LIMITS`，其中 `maxRate`（4.8）由 `FLASH_LIMITS` 算出（纯逻辑，无需音频即可测试）。
  - `letters.ts`：文字里的字母（`letterSlots`）、它们的权重、三个级别和带滞后的分配、每个级别的值（`levelPosition`、`levelSets`）、字母在级别之间移动的大小（`switchSwing`），以及一帧额外的任务（`buildLetterFrame`、`levelKeyAt`），见第 5.2 节；还有 Thorn 轮换，见第 5.3 节：轮换目标（`isTurnTarget`）、轮换组（`turnGroups`）、轮换状态（`thornState`、`thornDiffers`、`turnSwing`）、各组的状态（`ThornTurns`），以及每组的各级别参数（`turnSets`）（纯逻辑）。
  - `mappingStore.ts`：一个带 hook 的小型存储，保存映射、Response 的四个值和 Drive letters（驱动字母）开关；页面打开期间跟随 `prefers-reduced-motion` 的变化。它的修改会记入撤销历史（`src/state/history.ts`），映射和 Response 的值随会话一起保存（`src/state/persist.ts`），同时保存的还有音频引擎的 Sensitivity 和 Release；Drive letters 两者都不参与。
  - `presets.ts`：预设列表（`PRESETS`，第 7 节），每个预设带有名称、它的 ⓘ 里显示的一行说明、起始值和它的映射；以及 `presetSettings`（纯函数），给出 Load 之后的结果：设置（Geometry 和 Experimental 的每个分组都恢复默认、保留种子，再设上起始值）、改变了的分组，以及提示。
  - `live.ts`：帧调度（`LiveScheduler`，持有闪烁预算、`FlashLimiter` 和 `JumpTracker`，并给字母分配级别；它的依赖 `LiveDeps` 是注入的，`tests/sound` 用假时钟、假几何客户端和假 React 替换它们；它还把 Thorn 轮换交给各组并为其支取预算，第 5.3 节）、滑块和级别上的闪烁限制（`FlashLimiter`，第 10 节）、提供实时帧（`useLiveFrame`：共享参数和处在其他级别的字母）、文字中的字母（`useLiveLetters`）、实时标记位置、实时种子（`useLiveSeed`）和实时状态的 hook、从一帧到上屏测得的延迟（`liveLatencyMs`，供录制的音频使用），以及 Freeze。标记组件本身是 `src/components/LiveMarker.tsx`，种子输入框旁的实时种子是 `src/components/LiveSeed.tsx`。
- **`src/export/` 里为视频新增的代码（第 9 节）：**
  - `videoFormat.ts`：要尝试的 MIME 类型、视频尺寸和码率、音频延迟、文件名和计时显示（`VIDEO_LIMITS`；纯逻辑）。
  - `drawArtboard.ts`：按 SVG 导出的排布方式把画板画进 2D 画布，只用直线段（纯逻辑，带一个测试可以伪造的绘制接口）。
  - `recorder.ts`：`RecordingController`，一次录制的状态机，时钟、定时器、浏览器检查、录制器和音频引擎都是注入的；页面唯一的控制器及其 hook（`getRecorder`、`useRecording`、`useRecordingContext`）在文件末尾。
  - 界面：`src/components/RecordControls.tsx`（Record 分组，以及它和 Export 对话框共用的选项）、`RecordingCanvas.tsx`（一次录制所录的隐藏画布）和 `RecordingIndicator.tsx`（在页头）。
- **流程不变；实时请求带 `live` 标记。** 实时参数作为带 `live` 标记的计算请求发给几何 Worker；Worker 本来就会在字形之间丢弃已被取代的请求。这个标记只让实时结果存入单独的实时缓存（见下文），几何的计算方式不变，而且只在 Worker 里计算：页面自己从不计算字形。调度器先向 Worker 要一个实时帧的字形（`geometryClient.prefetchJobs`），等它们全部到达后才把这一帧交给 React，所以每一帧只渲染一次，而且是完整的（第 2 节）。客户端把这一个请求按字形分给它的一组 Worker（2 到 4 个），所有 Worker 的部分都返回后请求才结束，所以仍然只有一帧在计算；打开 Thorn Burst 和 Dissolve 时，一个 200 字符的 Roboto 帧用 4 个 Worker 需要 698 毫秒，用 1 个需要 2334 毫秒（README，几何 Worker）。提交仍然每秒最多 30 次；一次提交如果一直没有渲染，从提交时算起 1 秒后就不再挡住下一次。
- **每帧一个请求，分成多个任务：** 一个计算请求带有 `jobs`，每个任务是一组参数及其键和字形 id（`src/geometry/types.ts` 中的 `GeometryJob`）。一个实时帧就是一个请求：任务 0 是画布显示的每个字形的共享参数（即 H 阶段之前的那个请求），然后是 strong 级别，再是 quiet 级别，各自只带它的字母的字形 id，每个只出现一次，按阅读顺序。有 Thorn 轮换（第 5.3 节）时，后面再跟各轮换组的参数，各自只带自己字母的字形 id；任务 0 只请求显示共享值的字母的字形和所选字形（`FrameJob.within`，`src/state/geometryClient.ts` 中的 `shownGlyphs`），所以即使一帧的字母用到多达 15 组参数，没有级别时每个字形仍大约只算一次。Worker 按顺序计算各任务及其中的字形，每个任务结束时把结果发出（所以每条 `results` 消息只对应一个键），心跳消息里带上键，最后发一个 `done`；更新的请求仍会在字形之间让它停下。客户端（`computeJobs`、`prefetchJobs`）只发送缺少的（键，字形）对，只有正在处理的请求包含了全部缺少的对时才等它，并且只让任务 0 的结果在其他设置计算期间临时代替字形显示。Response 设置为中性值且 Thorn 关闭时，请求和 H 阶段之前完全相同。
- **没有字体就不驱动：** 调度器会被告知是否载入了字体。没有字体时，它不提交任何东西，不显示标记和实时种子，不报告实时状态，种子也不跳变；Sound 驱动时字体没了，滑块和种子会完全恢复（第 10 节）。
- **跟随实时参数的：** 字母（各在自己的级别上，Thorn 打开时再配上所在轮换组的状态）、文字预览（每个字母有自己的形状）、视频录制（第 9 节）、画布上画出的吸附网格和状态栏的描述（后两者取自共享值）。保持滑块值的：滑块、SVG、PNG 和 OTF 导出、Typography 标签页里的 Fit text 和 Free（和导出一样，它们测量滑块值下的字母），以及文字块所在的位置（见下）。
- **静止的文字块**（`src/specimen/artboard.ts` 中的 `placementScene`，`src/state/useDerivedGeometry.ts` 中的 `useGeometry`）：Sound 驱动字母时，文字块在画板上的位置由滑块值下的字母（滑块场景）决定，而不是由实时帧决定，实时字母就画在这个位置上。行和笔位来自步进宽度，所以两者相同；只有按轮廓测量的外框不同。所以不论效果、种子、预设还是 Response 设置如何，Sound 都不会移动文字块。以前，排版测量每个实时帧的轮廓（不含刺），所以种子跳变、Motion contrast、Pitch reactive，以及 Jitter、Flicker、Scatter、Gale 等预设仍会让文字块逐帧晃动。
  - 滑块值下的字母通常在正常编辑时已经保留着。Sound 驱动字母期间，如果滑块、文字、字体或排版改变了，还缺的字形会在这些输入静止 200 ms（`SLIDER_SCENE_DELAY_MS`）之后再请求，每次改变发一个普通请求，而不是拖动时每帧一个。结果到达之前，文字块沿用同一段已排版文字上一次完整放置的滑块字母；如果没有（新文字），就用实时排版代替。
  - 警告 "The text runs past the canvas edge" 也按滑块值下的字母测量，因为导出用的就是它们。所以一个比滑块字母变形得更远的实时字母，可能伸出画板边缘而不触发警告：画布上仍然显示它，预览和视频则在边缘把它裁掉。
  - Freeze 会改变滑块，所以那时文字块可能移动一次。视频画的是同一个场景、同一个位置，所以视频里文字块也不动。关闭 Sound 时一切照旧。
- **自适应帧率：**
  - 特征每个动画帧更新一次（`requestAnimationFrame`），所以标签页被隐藏或被遮住时一帧也没有：字母不再跟随声音，直到标签页重新显示（标签页被隐藏时录像本来就会停止，第 9 节）。
  - 同一时间最多只有一个几何请求在处理；上一个完成后才发下一个，所以帧率随计算量变化。
  - 帧率上限为 30 fps，Sound 标签页会显示当前帧率。
  - 低于约 8 fps 时，会建议用更轻的设置或更短的文字。
- **实时值取整：** 每个值都取整到所在滑块的档位（种子本来就是整数），这样重复的值会命中几何缓存，而不必重新计算。
- **单独的实时缓存：** 实时帧在 Worker 里使用自己的小缓存（约 600 条），所以一首歌不会把正常编辑时缓存的结果挤掉。页面保留两帧的实时参数结果，即屏幕上的一帧和正在计算的一帧：取最近 4 个实时请求中请求组数最多那个的两倍，至少 6 组（两帧各三个级别），最多 32 组（`LIVE_KEPT_KEYS`：有 Thorn 轮换时两帧各最多 16 组，即字母显示的 15 组加上共享的一组）。最久没被请求的先丢掉，所以另一帧计算期间，屏幕上仍在用的参数组不会被丢掉；帧重新变小之后，又像以前一样保留 6 组。
- **范围：** 和现在一样，只计算文字里的字形和当前选中的字形。
- **空闲时的音频：** 音频上下文在第一次需要它的用户操作（选择文件或来源、Play、Start listening）中创建，没有播放也没有收音 2 秒后会暂停，Play 和 Start listening 会让它恢复。注意：在 Safari 中，之后用媒体键重新开始的播放可能没有声音，直到用户按下 Play。
- **实测耗时：**
  - 只有 Geometry 时，每个字形约 0.1 ms。
  - 所有 Experimental 效果同时翻折时，每个字形最多约 20 ms，对较长的文字来说太重，无法实时使用。
  - 实时帧（在 worker 中测量；Node、Arial、默认文字的 24 个不同字形，特征扫动时取 30 帧）：Level → Distortion 的 Noise amplitude 约 2.6 ms，Level → Crumple Amount 7.4 ms，Bass → Ripple Petals 6.2 ms，三者同时 12.3 ms，都达到 30 fps 上限。Crumple、Ripple、Whorl、Slipstream 全开时每帧约 41 ms（约 24 fps）。重复的值命中缓存，不到 0.1 ms；页面上排布字形和画板每次渲染约 0.3 ms。第 3 阶段完成后重新测量，结果在每次运行的波动范围内相同：2.4 ms，三者同时 12 ms，全部打开 37–41 ms（24–27 fps）。Experimental 的这些数字早于 Crumple、Slipstream 和 Thorn 的重做（EXPERIMENTAL_PLAN 第 4.9 节），重做让它们都变重了（默认设置下每个字形约 0.6–0.9 毫秒）；下面 H 阶段的表重新测量了它们。NOCUR-60 撤回了 Crumple 的重做，所以这里 Crumple 的数字又对应现在的 Crumple。
  - **H 阶段，逐字母级别**（Node、单线程、每一帧都不命中缓存；Roboto、默认文字：226 个字母，其中 196 个要绘制，24 个字形 id；10 帧的每帧耗时中位数，最重的一项取 5 帧；"Flare" 是该预设的起始值，只带它的 Reach 那一行；不含闪烁限制）：

    | 负载 | 中性 | Motion contrast 100% | Pitch reactive 200% | 两者都开 |
    |---|---|---|---|---|
    | Level → Distortion · Noise amplitude | 3.3 | 6.6 | 7.1 | 6.1 |
    | Thorn（驱动 Reach 和 Root） | 15.2 | 30.5 | 29.5 | 25.3 |
    | Flare | 6.3 | 13.9 | 16.3 | 15.1 |
    | Crumple、Ripple、Whorl 和 Slipstream 全开 | 74.7 | 446 | 311 | 503 |

    - 每帧计算的字形数：中性 24 个；Motion contrast 100% 时 54 个，Pitch reactive 200% 时 61 个，两者都开 54 个。
    - Pitch reactive 的数字是在它跟随旋律音域（第 5.2 节）之前测的，当时音高放在 Pitch 的整个刻度上；每帧的计算方式没有变化。
    - 把字母分到各级别每帧耗时 0.09–0.15 ms。
    - 所以轻负载和 Flare 都在 30 fps 上限之内，Thorn 大约正好在上限上；四个重效果同时打开时，从每秒约 13 帧降到 2–3 帧。这时会显示变慢的提示；不会自动降低任何设置。
    - 声音持续不变时，各级别的值保持不动，所以字母在级别之间漂移不需要新的字形。
    - Thorn 和 Flare 两行早于 Thorn 轮换（第 5.3 节）；此后级别不再缩放 Thorn 的滑块。
    - 打开 Crumple 的那一行是用第 9 阶段重做后的 Crumple 测量的，早于 NOCUR-60 恢复单一方形格子。
  - **Thorn 轮换与静止的文字块**（H 阶段之后测得；箭头表示之前 → 之后）：
    - Node 端到端（EB Garamond 187 像素，"Hello / This is / Ming"，中性 Response，类似 Flare 的一组设置）：字母的刺每秒变化 283.9 → 7.2 次（算上 Distortion 和两个 Amount 在内的所有形状变化，299.7 → 7.4 次）；任意 250 ms 内刺变化的字母最多 15 → 3 个；同一字母两次刺变化的最短间隔 33 → 1,331 ms；文字块移动 0 px；每秒几何计算耗时 340 → 135 ms；没有曲线。
    - Headless Chrome（Roboto，"Hello / This is / Ming"，15 个字母；打开 Thorn（Anchors 3）、Crumple、Ripple 和 Distortion；Beat → Seed、Level → Thorn · Reach、Beat → Thorn · Anchors，以及 Level → Distortion · Noise amplitude；42 s 测试音轨）：8 s 内文字块只有一个位置，任意 250 ms 内最多 3 个字母变化，同一字母两次变化的最短间隔为 1,533 ms，每秒 7.9 次字母变化，没有曲线，Live 为 30 fps。
  - 种子跳变一次就是一组新参数，所以每个不同的字形都要重新计算：在 worker 中每个跳变帧约 2–3.5 ms（同样的设置，Beat 分别驱动三个种子），远在 30 fps 上限之内。
  - 特征提取（`process`，Node，48 kHz）加入第 3 阶段的特征后，每帧从约 35 µs 增加到约 90 µs，主要来自 Pitch；合并成 10 个之后仍是这个水平（在类似音乐的混音上 89–93 µs）；累计跳变不到 1 µs。
  - 页面上，Geometry 和 Experimental 标签页的控件以及字形列表会跳过实时帧，除非它们自己的统计数字变了（`React.memo`）：在生产构建中（Arial、默认文字、驱动 Noise amplitude），每个实时帧的页面 JavaScript 从约 5.3 ms 降到约 4.5 ms。种子输入框旁的实时种子自己订阅更新（`LiveSeed`），所以这些控件不需要新的属性；只有 Distortion 和 Random anchors 会在实时种子变化时为统计数字额外重新渲染。
  - 因为实时帧要等字形到齐才交给 React，页面现在每帧只渲染一次，而不是两次。
  - 在浏览器中（Chromium、Roboto、测试音轨、Jitter 预设）：只有底鼓的一段 30 fps；踩镲的一段 Motion contrast 0% 时 23 fps，60% 时 16–17 fps。录制视频不会带来长任务（没有超过 50 ms 的）。
  - 尚未测量：每帧中有多少时间花在把结果复制到页面并重绘 SVG 上，这是主线程上的主要风险。在浏览器中测量（尚待完成），只有它限制帧率时才把实时视图改为 canvas 绘制。

## 9. 冻结、导出与可重复性

- **Freeze** 把屏幕上的实时值写入滑块，把屏幕上的实时种子写入种子输入框，并让声音暂停（暂停文件或停止收音），所以冻结下来的样子会留在屏幕上。它就成了普通的、可重复的设置，也是一个撤销步骤；按 Play 或 Start listening 可以继续。只要声音在驱动字母，它就可用（不会随节拍闪烁）；如果按下时共享的实时值正好和滑块与种子一致（例如两次鼓点之间），它只会暂停声音。它写入的是共享值（第 5.2 节）：处在 quiet 或 strong 级别的字母也随之取这些值，显示着较早 Thorn 设置的轮换组也一样（第 5.3 节）。因为它改变了滑块，文字块那时可能移动一次（第 8 节）。录制视频期间 Freeze 不可用。
- SVG、PNG 和 OTF 导出始终使用滑块值，从不使用实时音频。Sound 实时运行时，Export 对话框会说明这一点，并指向 Freeze（选 Video 时不显示这条说明）。
- 实时输出取决于时机，不可重复；冻结后的设置可以重复。视频留下的是一次表演（见下文）。
- **视频**（H 阶段已完成）：实时录下随声音运动的画布，每个字母都在自己的级别上（Thorn 打开时再配上所在轮换组的状态），并带上声音。文字块停在滑块字母决定的位置（第 8 节），所以视频不会晃动。
  - **开始：** 在 Sound 标签页的 Record 分组按 Record，或在 Export 对话框里选 Video，它的 Record 会在同一次点击中关闭对话框并开始录制。如果来源没有在运行，录制会启动文件（从当前的 Position 开始）或麦克风，等声音和第一帧画好后才开始录，结束时只有当来源是 Record 自己启动的，才会暂停它或停止收音。Whole file 从头播放文件，录制期间关闭 Loop，结束后恢复 Loop，除非用户在录制中改过它。
  - **帧：** 一块隐藏的画布（`RecordingCanvas`）在每一帧显示时重画画板（`drawArtboard`，非零填充，只用直线段）。一个按这次录制的 **Frame rate**（24、25、30、50 或 60 fps；默认 30）运行的帧时钟，把画布当时的样子取为一帧（`captureStream(0)` 加 `requestFrame`；没有 `requestFrame` 时改为按这个帧率采集），每一帧都排在第一帧之后整数帧的位置；时钟落后时跳过错过的帧。请求的帧要等画布下一次变化时才被取下，所以时钟每一拍都在同一个任务里先“碰一下”画布（把一个像素复制到它自己身上），这一帧就在下一次渲染更新时取下；什么都没画时，上一次画的内容就重复一帧。帧率大约等于选好的值，尽力而为：帧落在渲染更新上，所以 60 Hz 屏幕上的 60 fps 可能丢帧，而且文件是可变帧率的（`MediaRecorder` 没有帧率设置）。没有 `requestFrame` 时不运行帧时钟：浏览器按这个帧率采集，在画布变化时取帧。画面按实时帧率变化，每秒最多 30 次。
  - **外观：** 画布按它的 Color 设置；勾选 Use the preview look 时，用右下角预览的颜色和模糊。浏览器不能模糊画布时，录制不带模糊，并会说明。视频没有透明：背景色总是画上去。
  - **尺寸：** 画布尺寸乘以它的导出倍率（和 PNG 一样），缩小到长边不超过 3840 px、面积不超过 3840 × 2160，取偶数。视频码率在 30 fps 时为每像素每秒 4.5 比特，随帧率按比例变化，限制在 2–12 Mbps 之间（从大约 1080p、30 fps 起就到了上限，所以那时 50 和 60 fps 的码率和 30 fps 差不多）（无论帧率多少，10 分钟最多约 0.9 GB，保存在内存中）；音频 128 kbps。
  - **格式：** 浏览器能写 MP4（H.264、AAC）时用 MP4，否则用 WebM（VP9 或 VP8、Opus），并提示 "MP4 isn't supported in this browser: saved as WebM."。候选格式依次尝试，直到有一个能开始。
  - **声音：** 听到的来源（文件，或麦克风：它仍然从不送到扬声器）经过一个延迟进入视频的音轨。延迟等于测得的实时延迟加 37 ms（半个分析窗口加一个显示帧），再加半个视频帧（等帧时钟取走的平均时间），在 40–400 ms 之间，还没有任何实时帧时为 90 ms 加半个视频帧；它在开始时设定一次。听众听到的声音不变。
  - **结束：** 录制在以下情况停止并保存：到达 Length（Until stopped、5、10、15、30 或 60 s，或 Whole file）、到达 10 分钟上限、声音停止、播完或切换、标签页被隐藏、画布尺寸或倍率改变、字体被关闭，以及录制器出错（保存已录下的部分）。按 Stop 会立即请求画布当时的样子；之后（连同帧时钟）再多录 100 ms，好把最后一帧录进去，离录制器停止不到 10 ms 的时钟帧不再请求；到达 Length，或文件暂停或播完时，多录音频延迟再加 100 ms，好把还在延迟里的声音结尾录进去；标签页被隐藏、出错、尺寸或字体改变时立即停止。每次结束都会说明原因，以及保存的文件名、时长和尺寸（"Saved Roboto-Regular-video.webm: 0:05, 1200 × 800 px."）。
  - **文件名：** 字体家族、样式和 `video`（使用预览外观时为 `video-preview`），和其他导出一样通过同一个下载保存一次。
  - 选项（Format、Length、Frame rate、Include audio、Use the preview look）只在本次访问有效：不保存、不撤销，录制期间锁定。录制期间关闭页面会先询问。

## 10. 安全与无障碍

- **闪烁：** 快速的摆动可能造成闪烁（WCAG 的三次闪烁阈值）。
  - **所有映射共用一个预算**（已完成，`src/sound/flash.ts` 里的 `FlashBudget`）：屏幕上的每一次大变化（一个边沿），无论来自哪个被驱动的滑块还是哪个种子，都从同一个预算中支取：任意 1.25 秒内最多 6 个边沿，所以不管有多少映射，Sound 每秒最多造成 3 次闪烁。边沿按测量帧的时间在 1.25 秒（比一秒稍长）内计数，所以晚到最多四分之一秒（等待几何计算）才到达屏幕的帧，在屏幕上任意一秒内也不超过 6 个。同一测量帧里的边沿（滑块的折返和种子的跳变）会一起到达屏幕，只算一次。
  - 连续映射（已完成）：每个被驱动的滑块有一个方向，以及它朝这个方向到过的极值；从极值往回走就是折返。当各滑块往回走的距离加起来达到一个滑块滑道的 10% 时，这一帧算一个边沿：可以是一个滑块摆这么远，也可以是几个较小的摆动一起，所以几个滑块同步、各自不到 10% 的摆动也绕不过这个限制。折返按显示出来的滑块位置（取整到档位之后）计数。预算用完时，正在往回走的滑块保持上一个值，直到预算空出来，其余滑块照常；保持的值是滑块片刻之前给出的值（第 2 节），标记和 Freeze 也使用它。
  - 用在滑块上的 Beat 也是连续映射，所以同样的限制也约束它的脉冲。
  - 种子（已完成）：一个跳变帧（同一帧里一起跳变的所有种子）从同一个预算中支取一个边沿。超出限制的跳变会被跳过，而不是推迟或攒起来，因为推迟的跳变已经跟不上声音了。用其他特征时，在没有滑块摆动的情况下，每秒 4.8 次跳变（Rate 100%、特征为 1 时）就是这个限制平均允许的最大值；滑块越忙，留给跳变的就越少。
  - **处在其他级别的字母**（第 5.2 节），使屏幕上的每一个字母都遵守限制：
    - **分散规则：** 被驱动滑块往回走的距离，取它的共享移动和每个级别移动中最大的那个，级别指某个要绘制的字母显示着（屏幕上、上一次更新中或即将显示）的级别。级别是共享位置的单调映射（`levelPosition`），所以只有共享值折返时它才折返，它的极值就是共享极值的映射，而保持住共享值就保持住了每个级别。在滑块两端截断只会缩小级别的移动。没有字母离开共享级别时，限制和以前完全一样。
    - **切换量：** 字母在级别之间移动本身也是一种变化（`switchSwing`）：对每个改变了级别的要绘制字母，取它在文字中的份额乘以两个级别的滑块相距多远（对所有被驱动的滑块求和，以滑块行程计）。达到 10% 及以上的移动就是一个边沿，从同一个预算中支取。它从屏幕正在显示或即将显示的那一帧的级别量起，而不是从上一次更新量起，因为下一帧开始之前可能已经过了好几次更新；同时也从最近 250 ms 内显示过的每一帧的级别量起（`LIVE_LIMITS.switchSpanMs`，`screenTrail`），取移动较大的那个：一次换音要经过几帧才到达屏幕（音高经过平滑，帧每秒最多 30 个），每一帧都不到 10%，这样它就按看起来的那一次变化计算。它在每个显示的帧里只计一次；一次移动从预算中支取之后，这串记录从显示它的那一帧起重新开始。和滑块折返或种子跳变在同一测量帧里时，只算一次。预算用完时，每个字母都保持屏幕上的级别。不区分方向，这样更稳妥。只有 Motion contrast 的漂移时，切换量远低于 10%（最多约 2%），所以从不会被拦住；Pitch reactive 200% 时，一次让许多字母同时移动的音高跳变就是一个边沿。
    - **滞后** 让分界线附近的字母不会来回翻转（第 5.2 节）。
    - **重置：** 停止、改变 Motion contrast 或 Pitch reactive、编辑文字（字母数量变了）都会让级别重新开始，第一次分配不算边沿，就像一个目标第一次出现时不算一样。拖动 Strength 或 Melody tracking 时保留级别，所以拖动期间的级别切换仍从预算中支取；同样的文字换了排版也保留级别。
  - **Thorn 轮换**（第 5.3 节），让刺也遵守这个限制：一次轮换本身算一次变化，量法和级别之间的移动一样，即该组在文字中的份额乘以它的轮换目标的滑块移动了多远（求和，以滑块行程计），换一个新种子算一整个行程。达到 10% 及以上的轮换从同一个预算中支取一个边沿，按测量帧的时间计。预算拒绝的轮换不像种子跳变那样被跳过：它会等待，该组保持显示的状态，下一次更新时再申请。轮换像级别一样重新开始：所有组同时取得实时状态，不算边沿（第 5.3 节）。Thorn 关闭时没有轮换，限制和以前完全一样。
  - 暂停、停止、关闭 Drive letters、Strength 为 0%，或字体没了时，滑块和种子回到自己的值（完全恢复），再次播放时从这些值开始。预算在此期间保留它的边沿；回到原值本身也支取一个边沿（不论预算怎么说，它都会显示出来），所以快速暂停再播放不会放出第二串变化。
  - 在测试音轨上，Beat → Distortion · Seed 在只有底鼓的段落每秒跳变 1.89 次（即节拍频率），在每秒 8 个节拍时被限制在每秒约 4.3–4.5 次，屏幕上任意一秒内种子最多变化 6 次。
- **减少动态效果：** 开启 `prefers-reduced-motion` 时，**Drive letters** 默认关闭（电平表照常工作），Sound 标签页会说明原因；页面打开期间才开启减少动态效果时，它也会自动关闭。
- **麦克风：** 只在用户明确点击后启用，显示可见的指示标记，停止时释放。
- **不联网：** 什么都不上传，音频不会离开浏览器。视频作为下载保存在用户自己的电脑上。

## 11. 界面

所有标签都用英文，尽量简短，说明收在 ⓘ 按钮里。

- 第三个标签页 **Sound**，在 Geometry 和 Experimental 旁边。和现在一样，浏览器会记住选中的标签页。这个标签页的控件在第一次打开时才加载，之后一直保留。它的分组依次是：Source、Levels、Mappings、Response、Record。
- **Source（来源）：** File / Microphone，默认为 File（没有 Off）。File 有 Choose file、播放/暂停、Loop、进度和文件名。Microphone 有 Start listening / Stop listening 和使用中的指示标记；选中它会暂停文件，选回 File 会释放麦克风。
- **布局**（NOCUR-71）：像合成器插件一样分成五个框：Transport（来源、Drive letters、Preset 和 Load、Freeze 以及帧率）、Input（Sensitivity 和 Release 旋钮，旁边是电平表）、Response（四个旋钮）、Modulation（映射）和 Record（可收起）。每个数值设置都是旋钮（`Knob.tsx`：拖动、按键、双击恢复默认值、在数字框里输入数值），范围和档位与它取代的滑块相同。
- **电平表**（在 Input 框里）：
  - 一排 11 个竖直的小 LED 电平表，每个特征一个，带简称（LVL … PAN；全名在提示文字和无障碍名称里）。电平表下方的一行显示 Level 的数字，或者鼠标指着的、或有键盘焦点的电平表的数字（只占一个 Tab 停靠点，用左右方向键移动），并带一个 ⓘ，用通俗的话解释所有分组。音高置信度没有电平表。
  - 数字：Level 以 dB 显示，Pitch 以 Hz 显示（静音时为 "—"），Pan 显示偏向哪一边（"L 40"、"R 40"，离中心 5% 以内为 "C"），其余以百分比显示；没有播放时为 "—"。电平表按整格点亮；Pan 从中间向上（右）或向下（左）点亮。
  - Beat 是脉冲：每次起音时跳到满格，然后回落。和所有电平表一样，它没有过渡动画，所以开启减少动态效果时照样工作。
  - 电平表每帧更新，数字每秒最多更新 10 次，提供给屏幕阅读器的值每秒最多 4 次。
- **Drive letters：** 一个开关（`role="switch"` 的复选框，画成按主题配色的小滑轨和圆钮）；只有打开时声音才会移动字母。开启减少动态效果时它一开始是关的，并说明原因（第 10 节）。Strength 为 0% 时，它下方有一行说明 "Strength is 0%: the letters hold still."。
- **映射：**
  - **Preset** 和 **Load**，在各行上方，带一个 ⓘ，说明 Load 会恢复哪些默认值、撤销可以恢复之前的设置和映射，并给每个预设一行说明。在列表里选择只是选中，所以用键盘浏览列表不会替换任何东西；按 Load 才应用预设（第 7 节）。这一行下方有一个状态行，说明上一次 Load 做了什么（“Loaded X. Turned off …. Other Geometry and Experimental settings back to defaults (seeds kept).”），一直保留到下一次 Load、在列表里选了另一个预设，或者撤销或重做为止。
  - 每行占一行：开关 LED、Feature（与电平表说明相同的分组）、Target（分组：Geometry / Experimental / Switches / Typography / Color / Variable axes；选项显示为 "Section · Label"，Experimental 的种子只显示 "Seed"）、一个小的双极 Depth 旋钮，以及打开该行详情的展开按钮（同一时间只展开一行：先是该行的塑形设置——Mode 为 Follow / Trigger / Toggle 分段控件，Gate、Curve 和 Smooth 为小旋钮，目标是滑块时还有双滑块的 Range（NOCUR-72；含义见 README → 塑形）——然后是 Remove，以及 Rate 的 ⓘ）。在种子上，Depth 改为 **Rate**，0–100%，步长 1%，并带一个 ⓘ，其中也说明种子和滑块共用每秒 3 次闪烁的限制，滑块越忙，跳变就越少。行内控件的名称带行号（“Remove mapping 2”）；目标当前不起作用时，行下方的说明也是 Target 的描述。
  - 行下方：选择目标时打开了什么的提示，一直保留到该行的目标再次改变；或者，目标不起作用时，说明原因并提供 **Enable**（屏幕阅读器读作 “Enable, mapping 2”）。
  - **Add mapping**，以及每行详情里的 Remove。删除一行后，键盘焦点移到下一行的展开按钮（没有时移到上一行的，都没有时移到 Add mapping）。
  - **拖拽映射**（§5）：用 pointer 事件，不用 HTML 拖放。在电平表上按下后移动超过 4 px 就开始拖动：一个主色薄荷绿的方形小标签跟随指针，写着特征名称（经过目标时再加上目标名称）；所有放置区出现薄荷绿虚线框，指针下的那个变成实线框，页面其他部分没有反应。每个目标的实时标记都会渲染一个锚点（`MapTarget`），把它所在的字段标记为放置区，所以新控件随它的标记一起获得放置区；有一个测试渲染各个面板，检查每个目标都有放置区。颜色的两个目标在色块上有两个放置区 Hue 和 Lightness，只在拖动时显示。在标签（Geometry、Experimental、Sound、Typography、Color）上停留 400 ms 会打开它，指针靠近可滚动面板的顶部或底部时面板会滚动。按 Escape 或在放置区以外松开即取消。放下后停留在当前标签页；控件下方的简短消息说明映射了什么、打开了什么（或映射已存在，或已达上限），对应的行加上边框，新行标为 “New”，直到用户用到它。
  - 键盘：在电平表上按 Enter 或空格开始选择目标；Tab、Shift+Tab 和方向键按 Target 列表的顺序经过所有目标（打开它的标签页并给控件加框），Enter 映射，Escape 取消，每一步都通过 polite 实时区域朗读。之后焦点移到被映射的控件（颜色则是它的第一个输入框）；没有可聚焦的东西（可变轴）或按 Escape 时回到电平表。用指针在任何地方按下都会取消选择，焦点留在按下的位置；按住 Enter 只开始一次选择，不会映射。Feature 和 Target 下拉框照常可用。
  - **Freeze**，在这个分组的末尾，旁边显示 "Live · N fps"。录制视频期间它不可用（`aria-disabled`，保留键盘焦点），并显示 "Freeze is off while recording."。它的 ⓘ 还说明，按不同幅度响应的字母会取共享值。
  - 变慢的提示，低于约 8 fps 时显示："Too slow to follow the sound: try fewer effects or a shorter text."；Motion contrast 或 Pitch reactive 大于 0 时改为 "Too slow to follow the sound: try fewer effects, a shorter text, or less Motion contrast and Pitch reactive."。
- **Response**（取代原来的 Analysis 分组）：依次是 Sensitivity、Strength、Motion contrast、Release、Pitch reactive、Melody tracking 和 Glide（第 5.1 节），每个都是带数值（dB、% 或 ms）和通俗 ⓘ 说明的滑块；然后是 **Reset sound**，它用一个撤销步骤把七个值都恢复，已经是默认值时不可用。
- **Record**（第 9 节）：
  - **Record**，录制期间变成 **Stop**（图标加文字），已录的时间（"0:12"，设了 Length 时为 "0:12 / 0:30"），以及 "Live · N fps"。
  - 一次录制的选项，与 Export 对话框共用：**Format**（MP4 或 WebM；浏览器不能写的那个会变灰，并显示 "(not supported in this browser)"）、**Length**（Until stopped、5 s、10 s、15 s、30 s、60 s、Whole file；Whole file 需要音频文件）、**Frame rate**（24、25、30、50、60 fps，是一排按钮；默认 30）、**Include audio**（默认打开；用麦克风时，它的声音会进入文件）、**Use the preview look**（默认关闭），以及一行尺寸说明，例如 "1200 × 800 px · 30 fps · MP4"，被缩小时加上 " (scaled down to the 4K limit)"，调色板透明时还有一行说明背景会被画上。录制期间这些选项锁定。
  - Record 不能开始时，原因作为它的提示显示："This browser cannot record video."、"Load a font to record."、"Choose an audio file first." 或 "Opening the sound…"。
  - 实时帧率太慢时显示 "Too slow for a smooth video: try fewer effects or a shorter text."；Drive letters 关闭、Strength 为 0% 或没有任何映射有 Depth 时显示 "Sound is not moving the letters: the video will be still."。
  - 上一次录制是怎么结束的（保存的文件、附注或错误）。
- **页头：** 录制期间显示一个录制指示灯和 "Starting to record…"、"Recording 0:12" 或 "Saving the video…"，以及一个只有图标的 Stop 按钮（名称为 "Stop recording"）。录制结束后，它显示这次录制是怎么结束的，直到被关闭（一个只有图标的关闭按钮，名称为 "Dismiss"）或下一次录制开始。屏幕阅读器只读出开始和结束。Export 按钮的标题为 "Export SVG, PNG, a font file or a video"。
- **Export 对话框：** 第四种格式 **Video — live sound**（"Records the canvas as it moves with the sound, in real time, with its audio."）。它显示同样的选项和一个 **Record** 按钮，在同一次点击中关闭对话框并开始录制；录制期间再次打开对话框时提供 Stop，结束后显示这次录制是怎么结束的。选 Video 时，不显示“导出使用滑块值”和“参数仍在更新”这两条说明。
- **状态栏：** Sound 驱动字母时显示 "Live · N fps"（没有载入字体时从不显示）。N 计的是完整的帧，所有级别都算在内。它是几何计算的速率，而不是读取声音的频率（声音每个动画帧读取一次，第 8 节）。
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
  - H 阶段（已检查）：读数在 Release 时间后回落到 1/e；音高置信度在正弦波上高、在噪声上低，轻的音符更低；Melody 在上行或下行 2 个半音的一步上恰好脉冲一次且到满，在每秒 3 个半音的滑音上脉冲几次，而在持续的音、±50 或 ±80 音分的颤音、噪声、静音后的第一个音或滑进它的一小段、只有一帧的八度误判，以及 60 到 144 fps 下持续音上的底鼓上都不脉冲；重置会忘掉音符和脉冲。在测试音轨上，26–32 秒的 11 次换音每次都有一个 Melody 脉冲（11 次，允许差一次），音高置信度高，而之前的踩镲上一个都没有。旋律音域（5 项检查）：静音、噪声、踩镲以及 55 Hz 和 1760 Hz 的音给出 Pitch 的全部；持续的音符周围是一个八度，底鼓或只有一帧的八度误判不会移动它；C4 和 C5 交替时恰好从 C4 到 C5；跟随新的音区，停顿 2 秒保留音域，停顿 9 秒让它重新开始；重置会清除它。
- **调制：** Depth 为 0 或映射关闭时得到滑块值；值会被截断；多个作用相加；已关闭组里的目标不起作用；Beat 在释放时间内回落；Step 循环切换；频率限制有效；每秒 4 次的节拍在满 Depth 下，任意一秒内最多让滑块折返 6 次，每个值都落在滑块的档位上。
  - 共用的闪烁预算（已检查）：一个滑块、三个或五个同步或不同步的滑块、五个同步各摆 4% 的滑块、单独一个 Beat 种子，以及滑块加 Beat 种子，在任意一秒内都最多 6 次大变化（按帧和按屏幕分别测量），而只要音乐要求，每秒仍至少有 4 次通过。
  - 每个滑块目标的范围和档位都取自 `SLIDER_RANGES`（Tolerance 和 Thorn · Reach 取自它们各自的非线性刻度），并且只给出滑块自己能给出的值；Thorn · Reach 沿着与面板相同的三次方滑块移动。
  - 第 3 阶段（已检查）：10 个特征及其分组；42 个目标中的每一个，在 3000 组随机参数上（Refraction 也随机变化），都是恰好在起作用时不需要打开任何设置，它的修改能让它起作用，并且不改动其他任何东西；旧设置缺少重做后效果的六个字段时（NOCUR-60 去掉 Crumple 的 Detail 之前是七个），这六个目标按面板显示的值读取，Thorn 和 Refraction 处于任何状态时 Flute width 的提示都正确；种子超过最大值后回到 0，而且从不移动滑块；Beat 在 Rate 100%、50% 和 25% 时分别在每个、每隔一个和每四个节拍跳变；Level 为 1、Rate 100% 时每秒约 4.8 次跳变；每秒 16 个节拍时，任意 1.25 秒内的跳变帧从不超过 6 个；2 秒的卡顿最多带来一次跳变；暂停后回到输入框的种子，Freeze 写入屏幕上显示的实时种子。
  - Response（已检查）：取中性值时，`modulate` 对每个预设给出的结果都和没有这些值时完全相同；Strength 在截断之前缩放偏移量，为 0 时滑块完全保持原值；Melody tracking 加强除 Pan 行和 Melody 行以外的每个滑块行；Strength 缩放种子的 Rate（上限 100%），为 0 时不产生跳变；在调度器里，Strength 为 0 时停止驱动并完全恢复，并且会测量一帧到提交的延迟。
- **中性不变：** `tests/sound/neutral.test.ts` 在 H 阶段之前于 4a54e5d 锁定，永远不许为了迁就新代码而修改。它对每个预设的 `modulate`、起始设置不打开 Thorn 的每个预设（除 Flare 以外的全部）下实时调度器的请求、提交和 Freeze、当时特征帧的各字段（按 10 位有效数字，因为 V8 的 x64 版和 arm64 版在 `Math.log2` 和 `Math.log10` 的最后一位上不同），以及渲染成 SVG 的默认文字计算哈希。Response 控件取默认值时，每个哈希仍然一致。
  - **为什么不含 Flare：** Thorn 轮换（第 5.3 节）有意改变了 Flare 的实时帧，它是唯一一个起始设置打开 Thorn 的预设；它的新行为由 `tests/sound/turns.test.ts` 测试。调度器的锁定值（32a8121b）是在去掉 Flare 后从 4a54e5d 的导出重新取得的，从不取自新代码，并在 arm64 和 x64（在 Rosetta 下运行的官方 x64 版 Node 22.23.3）上分别用导出和新代码检查过。其他锁定值不变。
- **字母和级别**（已检查）：Motion contrast 为 0 时，每个字母在任何时刻都恰好为 1；更高时，它保持在自己的范围内，同一字母同一时刻结果相同，随时间漂移，并且是均衡的（quiet 和 strong 的字母一样多，大多数在共享级别上）；Pitch reactive 在 0% 时是中性的；`pitchPlace` 把音高放在旋律音域之内，低音和高音让 strong 级别的字母落在文字的两端；级别按设置固定并有上下限；权重在分界线附近 5% 摇摆时字母保持原级别，变化 30% 时才移动；`levelPosition` 在增益为 1 时不变、单调、落在档位上、保留在原来那一档内，并会被截断；其他级别保留种子；`buildLetterFrame` 把与共享级别相同的级别合并进去，每个字形只请求一次；字母的份额加起来为 1，空格和缺失的字形不参与，顺序与画布相同（`tests/specimen/occurrence.test.ts` 锁定了出现次序的计数）；换了排版的文字保留它的级别。
  - 带级别的闪烁限制（已检查）：没有级别时，限制和共享限制完全相同；滑块往回走的距离取所显示级别中最大的那个；在 Strength 400%、Motion contrast 100%、Pitch reactive 200%、音高每秒跳一个八度 6 次的情况下，以每秒 60 和 120 次更新，屏幕上的每个字母在任意一秒内最多 6 次大变化；Pitch reactive 200%、音高在两个八度间滑动时也一样。变化按屏幕显示的样子计数：字母在级别之间的移动，从最近 250 ms 内显示过的任何一帧算起，一帧里的变化只算一次。另外检查了：横跨整个旋律音域、每秒 6 次的八度保持在限制之内；真实音符经过 `FeatureExtractor` 和调度器（每帧计算 40 ms）：C4 和 C5 交替、各 500 ms 时，每个 C4 都停在左边（strong 级别字母的平均位置低于 0.35），每个 C5 都停在右边（高于 0.65），Pitch reactive 100% 时每个音符都到位，200% 时至少 80% 到位，而放在 Pitch 整个刻度上时，同样的跳进几乎移不动 strong 级别的字母；测试音轨的旋律在 100% 时，第二遍从左到右再回来（A2 低于 0.3，A5 高于 0.7，相邻两个音相差 0.1 以上，高的在右）；两者每秒都最多 6 次大变化。
  - 带级别的调度器（已检查）：中性设置下，请求和提交与没有字母时相同；Motion contrast 用一个请求得到最多三个级别，持续的声音会漂移到新的帧而不需要新的字形；编辑文字让级别重新开始，换排版则保留；开着 Motion contrast 时，Freeze 写入屏幕上的共享值，包括被保持住的值。
  - 任务（已检查）：Worker 按顺序计算各任务，每条 results 消息一个键，心跳带键，一个 done，更新的请求会让它在任务之间停下；客户端对每组参数只发送缺少的字形，只有正在处理的请求包含了全部缺少的字形时才等它，只让共享那组参数临时代替字形显示，按最近最少使用保留实时参数组，按心跳里指明的那组参数追究卡住的字形，Worker 缺少或打不开字体时重发或让每组参数失败。共用一个多边形的字母，其 SVG 路径和以前完全相同。
  - 保存与撤销（已检查）：读取 Sound 设置时会截断并取整，否则用默认值；拖动一次 Strength 或 Release 是一步；Reset sound 是一步；预设的 Load 不动 Response 的值。
- **Thorn 轮换**（已检查，`tests/sound/turns.test.ts`）：五个组，每组最多 ceil(N / 5) 个字母，字形保持完整，除非它整个放不进任何一组，各组散布在整段文字里；文字很短时每组一个字母、其余为空，没有字母时没有组；同样的字母换了排版分组不变；级别从不缩放 Thorn 的滑块或 Experimental 种子，Thorn 打开时也不缩放任何轮换目标，但仍缩放其他每个滑块；轮换状态包含每个会移动刺的目标，而不包含 Distortion，也不包含 Crumple 和 Ripple 的 Amount；一个组在出现新种子或新的刺数量、某个滑块相差半个摆幅，或回到滑块自身值时取得实时状态；一次轮换的大小是份额乘以滑块的移动，种子算一整个行程；每次轮换一个组，依次循环，在上一次轮换显示到屏幕上 250 ms 之后；被拒绝的轮换会等待，之后由同一个组接受；没有可变内容的组让出这一轮；短文字的字母最多每 1.25 s 轮换一次；Drive 开始、换了新文字、打开 Thorn 时轮换重新开始，新加一条映射时不会；用手移动一个声音不驱动的滑块会立即传到所有组；每个字母显示的都是面板能设置的滑块值和种子；Freeze 写入共享值。Thorn 关闭时，调度器的请求、提交（包括字母）和 Freeze 的哈希与 Thorn 轮换之前 develop 上的 f4483b5 相同。在 Roboto 的默认文字上用 Flare 加 Level → Distortion，在中性设置和 Motion contrast、Pitch reactive 均为 100% 时，12 s 的节拍里：每次变化只涉及一个组，最多五分之一的字母，变化之间至少隔 250 ms，同一字母至少隔 1.25 s，每个请求里每个键只有一组参数，中性设置下每个请求的字形计算次数最多比每个字形一次多五次（用于被拆到不同组里的字形和所选字形）。
  - 页面能保留两帧各 15 组参数，最多 `LIVE_KEPT_KEYS` 组，帧变小后又只保留 6 组（`tests/worker/geometryClient.test.ts`）。
- **静止的文字块**（已检查，`tests/specimen/placement.test.ts`）：没有 Sound 时文字块按显示的场景放置，和以前一样；Sound 驱动字母时按滑块字母放置，所以那些本会移动它的实时帧（三种倾斜角度、每个锚定位置和 Free、三种字号）让它分毫不动；滑块值下计算失败的字形算作已计算；滑块字母计算期间，由同一段已排版文字上一次完整放置的滑块字母代替；这段文字没有滑块字母时，用实时场景。
- **视频**（已检查，用假依赖，不碰 DOM）：MIME 候选按优先顺序排列，从 MP4 回退到 WebM，尺寸限制（偶数，至少 2 × 2），码率（随帧率变化）、音频延迟（加半帧）、可选的帧率、文件名和计时显示；`drawArtboard` 先画纸色，在 Roboto 的默认文字上把字形放在和 SVG 导出完全相同的位置，只给倾斜的文字加斜切，用每次出现自己的多边形填充每次出现，把字形作为一层整体模糊、不能模糊时就不带模糊绘制，只用直线段构建路径，`touchCanvas` 不改动画布其他部分；录制器等声音和第一帧，在 Length、上限、标签页隐藏或出错时停止（保存已有的部分），0 字节时什么都不保存，关闭 Loop 播放整个文件并恢复 Loop，尝试下一个 MIME 类型，声音无法分接时录无声视频，按实时延迟延后音频，只暂停自己启动的来源，没有 `requestFrame` 时按这次录制的帧率采集、这时不运行帧时钟，无论画布怎么画，每种帧率下时钟每拍请求一帧（每一拍都碰一下画布，没有变化时就重复上一次画的内容），按 Stop 时立即请求画布当时的样子，跳过落后的时钟错过的帧，录制结束后不再请求帧，锁定选项，并说明 Record 为什么不能开始。
- **没有曲线与有效性：** 实时帧里的每个字母都显示一组普通参数（H 阶段起每帧最多三组，第 5.2 节；有 Thorn 轮换时最多 15 组，第 5.3 节），已被现有审计覆盖。此外，记录一段测试音轨经过的参数组，在 Arial、New York 和 Georgia 上跑有效性审计和像曲线的段落审计。第 3 阶段（已检查）：在整段测试音轨上，同时映射到种子和滑块，878 次实时提交中的每一次都是面板能给出的一组值（滑块值落在档位上，种子是范围内的整数），种子每次变化都恰好前进一个。
- **音频引擎：** 在模拟的 Web Audio 节点上，立体声支路按第 4 节连接，测量用的节点都不通往扬声器，读取错位时会重读或保持。在 Chromium 中连续不断地探测读取，确实出现了错位，经过检查后没有一次传到特征里。
- **控件：** 面板里每个目标恰好有一个实时值标记（滑块）或实时种子（种子），并按 `TARGETS` 的顺序排列。
- **性能：** 每个预设在短文字和长文字上、以及在重度设置下的帧率。
- **测试音轨**（`test-audio/sound-test.wav`，42 秒，16 位立体声，44.1 kHz；由命令生成，不提交到仓库：`npm run test-track` 通过 `scripts/make-test-track.ts` 从 `scripts/test-track.ts` 渲染出它，git 会忽略它；采样和以前提交的文件完全相同）：0–26 秒和以前一样，左右声道相同（0–4 秒只有底鼓，4–8 秒底鼓加踩镲，8–12 秒逐渐变响的和弦，12–15.5 秒静音，15.5–21.5 秒逐渐变弱的完整混音，21.5–26 秒每秒 16 次的踩镲）；26–32 秒是从 A2 到 A5 再回来的单音旋律，用于 Pitch；32–38 秒是每半秒在最左和最右之间切换的踩镲，下面垫着居中的轻柔低音，用于 Pan；38–42 秒是逐渐减弱、左右互不相关的宽噪声（Pan 保持居中）。读数符合预期：前 26 秒和以前一样（只有底鼓时 Beat 约每秒 2 次；Activity 只有底鼓时约 0.38，有踩镲时 0.91–1），Pitch 随旋律为 110、220、440、880 Hz，Pan 每半秒约 ±0.5。
- **浏览器实测：** 用本地测试文件和麦克风测试，不下载任何东西。检查暂停、停止收音或关闭 Drive letters 是否让滑块完全恢复，并检查先 Freeze 再 Export。第 3 阶段（已检查）：用键盘浏览 Target 列表时，在按 Enter 或离开列表之前不会打开任何设置；用指针选择则立即打开。
  - H 阶段（在 Chromium 中用 Roboto 和测试音轨检查；下载通过替换 `HTMLAnchorElement.prototype.click` 截住，所以没有真的下载任何东西）：Response 和 Record 分组都显示出来；Motion contrast 60% 时，同一字形的各个字母形状不同（16–19 个字形有不止一种形状，预览里有 49–52 条不同的路径，而字形 id 只有 23 个），回到 0% 时没有，在 60% 时按 Freeze 之后也没有，滑块保持冻结的值，"Updating" 从不出现；1200 × 800 下 5 秒的 WebM 和 MP4 录制都保存了正确的帧；把 MP4 替换为不支持时，录制提示 "MP4 isn't supported in this browser: saved as WebM."；Export → Video → Record 会关闭对话框，页头显示 "Recording 0:02" 和 Stop；录制期间 Freeze 不可用，并显示它的说明；隐藏标签页会停止录制并保存（"Recording stopped because the tab was hidden."）；静止的画布仍然录得到帧；录制不会带来长任务；撤销会恢复 Response 的值，Sensitivity 会被保存并可撤销。
  - Pitch reactive（已在无头 Chrome 中检查，标签页可见，测试音轨 25–33 秒，Roboto 的默认文字，Jitter 的映射）：100% 时，每个音符结束时 strong 级别字母的平均位置按 A2 A3 A4 A5 A4 A3 依次为：旋律第一遍 0.47 0.83 0.83 0.83 0.64 0.26，第二遍 0.15 0.36 0.70 0.82 0.64 0.26；把音高放在 Pitch 整个刻度上时得到 0.22 0.38 0.57 0.72 0.62 0.43。标签页每秒约 60 个动画帧、13 次提交；标签页隐藏时没有帧也没有提交，所以字母保持不动，直到它重新显示。
  - 尚待在浏览器中检查（可选，用眼睛看）：录下的视频在底鼓一段里声音和画面是否同步。
- **自动测试：** `npm test`（快速测试，CI 也会运行）覆盖合成信号上的特征、Beat 能量门、Melody、音高置信度和旋律音域、带级别和不带级别的闪烁限制（包括真实音符上的 Pitch reactive）、映射和目标、Response 控件、字母和级别、用假依赖运行的实时调度器（每秒最多 30 次提交，一次一帧；帧很重时放慢，并在低于每秒 8 帧时说明；一次提交一直没有渲染时一秒后继续；停止时完全恢复；Freeze；只在载入字体时驱动；字母处在各自的级别上）、Thorn 轮换、静止的文字块、页面与 Worker 之间的任务、保存与撤销、用假依赖测试的视频录制、中性锁定，以及测试音轨每次渲染出同一个文件。`npm run test:slow` 按段读取整段测试音轨，检查上面预期的读数，包括旋律段的 Melody 脉冲。
- **文档：** README、用户指南、PRD、PHASE（H 阶段）和 BEST_PRACTICE，中英文分开写。

## 13. 阶段

| 阶段 | 内容 |
|---|---|
| 1 | Sound 标签页；音频引擎（File、Microphone）；特征 Level、三个频带（现在叫 Bass、Mids、Treble）、Brightness，以及带底鼓检测器的 Beat；电平表 |
| 2 | 调制层、连续目标的映射、带独立缓存的自适应实时调度、滑块上的实时值标记、连续映射的闪烁限制、Freeze |
| 3 | 已完成：作为跳变目标、带 Rate 的种子，它们的闪烁限制，以及输入框旁的实时种子；滑块上的 Beat 脉冲；新增 13 个特征，加上立体声测量支路，之后与最初的特征一起合并成五组共 10 个（第 4 节）；紧凑的电平表；自动打开所需设置的目标，带提示和 Enable；42 秒的立体声测试音轨；十个预设，带 Preset 和 Load，Load 会把 Geometry 和 Experimental 的设置恢复为默认值（保留种子）、设好预设的起始值，并说明关闭了什么；为 Flicker 而设的 Distortion 少数锚点模式；File 作为默认来源、没有 Off，Drive letters 改为开关；为重做后的 Experimental 效果新增七个目标（共 43 个；NOCUR-60 去掉 Crumple 的 Detail 之后为六个，共 42 个），并为它们重新设计 Flare 和 Gale。尚待完成：Step 映射（Allowed directions、Sides、Rings）；实时 SVG 重绘测量 |
| 4 | Pitch 和立体声（Pan）：已在第 3 阶段和其他新特征一起完成 |
| H | 已完成：Response 分组（Sensitivity、Strength、Motion contrast、Release（原来的 Smoothing）、Pitch reactive、Melody tracking），可保存、可撤销；每个字母在三个级别上按自己的幅度响应，闪烁限制作用于每个字母，每帧一个请求；Melody 特征和音高置信度；实时视频录制（MP4 或 WebM，带声音），可从 Record 分组、页头和 Export 对话框操作 |
| H 之后 | 已完成：Sound 不再移动的文字块，按滑块字母放置（第 8 节）；Thorn 轮换，五组字母依次取得 Thorn 的设置，最多每 250 ms 一组，每次轮换都受闪烁限制（第 5.3 节）；Thorn 的锚点在 Distortion 之前挑选，并保持过各次变形（EXPERIMENTAL_PLAN 第 4.8 节） |

阶段 1–4 是本计划自己的编号；H 即 PHASE.md 中的 Phase H。每个阶段都以第 12 节的验证收尾，并单独交付。
