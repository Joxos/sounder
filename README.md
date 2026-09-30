# Sounder

浏览器内的音乐**变调 / 变速**工具。调性与速度是两个互相独立的轴，音频不上传、不经过服务器。

完整调研与设计依据见 [`docs/实现计划.md`](docs/实现计划.md)，竞品长文见 [`research/key-speed-changer-report.md`](research/key-speed-changer-report.md)。

## 当前进度

- [x] **M0** 骨架：Svelte 5 + Vite + mediabunny 解码、峰值金字塔波形、播放/定位
- [x] **M1** 引擎：Signalsmith Stretch 实时无爆音调参、双轴控件、循环区、A/B 对比、键盘快捷键
- [x] **M2** 导出：离线渲染 + 音量 + WAV / MP3 / M4A，循环区间可只导出一遍

## 循环的两个概念

容易混，所以分开：

| | 循环区间 | 循环播放 |
|---|---|---|
| 作用范围 | 波形上框选的一段 | 整首 |
| 怎么设 | `Shift` + 拖动波形 | 开关按钮 / `L` 键 |
| 行为 | 该区间**反复重复** | 播完整首后**回到开头** |
| 影响导出 | 是，只导出该区间 | 否 |

开了循环区间后，播放头永远不会走到整首末尾，所以循环播放在那时没有意义——两个功能互不冲突。

播完的行为：**默认停止并回到开头**（播放头归零，按播放重新开始）。开循环播放则自动续播。

## 主题

深色为默认。右上角有「自动 / 浅色 / 深色」三档：

- **深色**（默认，首次访问即深色）
- **浅色**
- **自动** —— 跟随操作系统，并在系统主题变化时实时切换

选择存在 `localStorage`。`color-scheme` 也同步设置，所以原生控件（复选框等）跟着变。波形是 Canvas 绘制，改为从 CSS 变量取色，切换主题时会重绘。

## 响度补偿的作用域

响度对齐**只作用于试听**：它存在的意义是拖滑块时不炸耳，所以**不写进导出的文件**。测试验证了开关响度补偿后导出的采样**逐位相同**（最大差值 `0.00e+0`）。

导出会写入的只有两样：你的**音量**滑块，以及可选的**峰值归一化**（避免削波）。

变调变速**真的会改变感知响度**——这是拖滑块容易"炸耳"的根本原因。信号链：

```
stretch → 处理增益 → 响度补偿 → 汇总 ┐
原声   → 对比增益 ───────────────────┴→ 音量 → 限幅 → 输出表 → 扬声器
```

- **输出表**：`AnalyserNode` 实测真正送往设备的那一路，显示峰值 dBFS、RMS、当前目标响度和正在施加的补偿量。不是公式估算。
- **响度对齐原声**（默认开，只影响试听，不写入导出）：
  - 把处理后信号的响度拉回原声此刻的响度。
  - 目标来自**Worker 算好的响度包络**（100ms 一格），所以会跟着歌曲的动态走——安静的前奏保持安静，副歌不会突然变大。用整曲平均值当参考会漂移好几 dB。
  - 补偿上限 ±12 dB，双重平滑（1s 测量窗 + 0.6s 收敛），避免抽动。
  - 测量点取在**补偿之前**，所以不会自激。
- **限幅**：`DynamicsCompressorNode`，阈值 −1.5 dBFS、20:1、3ms attack。只是安全网，安静段落完全不受影响。
- 导出时同样应用响度补偿，并可额外**归一化到 −1 dBFS**。顺序是「响度补偿 → 音量 → 归一化」，音量永远是你最后一道决定。

实测（`Void.m4a`，原声 −11.7 dBFS）：

| 状态 | 输出 RMS | 补偿 |
|---|---|---|
| 原样 | −12.8 dB | −1.1 dB |
| 60% 速度 | −12.3 dB | +1.7 dB |
| 回到原样 | −13.2 dB | +0.3 dB |

拖动速度导致的电平漂移被压到 **1 dB 以内**（修复前是 3 dB）。

## 慢速会变糊吗

不会，**实测高频只损失 0.94 dB**，相对整体电平的倾斜 −0.41 dB（0.65× 速度）。这是正经的时域算法，不是朴素线性插值。

慢速时你感觉到的"糊"，主要是音乐本身被拉长后**瞬态和衰减天然重叠**造成的，不是插值质量差。

`blockMs` 确实有效果（0.65× 速度下测得）：

| 配置 | 高频倾斜 | 相对速度 |
|---|---|---|
| 默认 | −0.41 dB | 1.0× |
| blockMs 200 | −0.21 dB | ~0.9× |
| blockMs 320 | −0.07 dB | ~0.8× |

所以：**试听用默认档（低延迟跟手），导出用 blockMs 240**——离线渲染没有延迟成本，白赚质量。测试命令 `npm run test:quality`。

## 技术选型

| 层 | 选型 | 许可 |
|---|---|---|
| 框架 | Vite 7 + TypeScript + Svelte 5 | — |
| 变调/变速引擎 | [signalsmith-stretch](https://github.com/Signalsmith-Audio/signalsmith-stretch) 1.3.2 | MIT |
| 解码 / 编码 | [mediabunny](https://mediabunny.dev/) 1.61 + mp3/aac-encoder 扩展 | MPL-2.0 |
| 波形 | 自绘 Canvas + Worker 峰值金字塔 | — |

引擎选的是 **Chromium `HTMLMediaElement.preservesPitch` 背后同一套算法**（Geraint Luff, ADC22《Four Ways To Write A Pitch-Shifter》）。它提供 `schedule({outputTime, semitones, rate})` 自动化接口，拖滑块不会爆音也不需要重启播放。

**注意**：`signalsmith-stretch` 的 README 写的是 `schedule({output})`，但源码读的是 **`outputTime`**。传 `output` 会被静默忽略。见 `src/lib/signalsmith-stretch.d.ts`。

## 开发

```bash
npm install
npm run dev        # http://localhost:5173
npm run check      # svelte-check
npm run build
```

## 测试

`src/lib/selftest.ts` 是一组**在真实浏览器里**跑的 DSP 断言。Signalsmith Stretch 是 AudioWorklet 节点，Node 里跑不了，所以这些检查必须放在浏览器中。

先起一个开发服务器：

```bash
npm run dev -- --port 5183 --strictPort
```

| 命令 | 作用 |
|---|---|
| `npm run smoke` | 合成音频跑 DSP 断言 + 驱动真实 UI，不需要外部文件 |
| `npm run test:export <文件>` | 导出**回环测试**：编码后再解回来，验证音高与时长 |
| `npm run test:audio <文件>` | 用真实音频走完整 UI 链路，用 `AnalyserNode` 实测输出电平 |
| `npm run test:worklet` | worklet 回归测试（见下方「两个坑」） |
| `npm run inspect:file <文件>` | 诊断某个文件能否被解码、采样率/声道/时长 |

`smoke` 覆盖的关键断言——**变调与变速确实互相独立**：

| 用例 | 期望音高 | 期望时长 |
|---|---|---|
| 原样 | 0 st | 8.00 s |
| 速度 80% | 0 st | 10.00 s |
| +7 半音 | +7 st | 8.00 s |
| −3 半音 @ 85% | −3 st | 9.41 s |

`test:export` 会把导出的文件**再解码回来**测量，而不是只检查"没报错"——截断或音偏都会被抓出来：

| 检查 | 实测 |
|---|---|
| 离线渲染 @ +7st / 80% | +6.95 st，7.50 s（期望 7.50 s） |
| WAV 回环 | 音高时长完全一致 |
| MP3 回环 | +6.95 st，7.54 s（编码器补零） |
| M4A 回环 | +6.95 st，7.53 s |
| 音量写入文件 | 25% 音量 → 峰值 0.427 → 0.107 |
| 循环区间导出 | 1–3 s @ 80% → 2.50 s |

## 导出

导出走的是**和试听完全相同的引擎**，只是挂在 `OfflineAudioContext` 上离线渲染，所以**所听即所得**。节点自身的延迟会从头部裁掉、尾部截到目标长度，文件开头结尾落在音乐上而不是静音上。

- 音量条会**一并写入文件**
- 开了循环区间时，只导出该区间的一遍
- 编码器按需加载：MP3 全靠 WASM（LAME，131 KB gzip），M4A 优先用浏览器原生 AAC，只有原生不可用时才加载 WASM 兜底（257 KB gzip）。首屏不加载这些

真实文件实测（`Void.m4a`，213 s 双声道，+3 半音 / 85% 速度）：

```
解码 1002ms → 离线渲染 250.7s 音频 / 7.65s（33× 实时）→ MP3 编码 3.9s / 7.8MB
```


## 两个坑（都踩过）

**1. `numberOfInputs` 必须是 1。** worklet 在未激活分支里写的是 `inputs[c % inputs.length]`，**没有空值保护**。传 `0` 会让 `inputList[0]` 是 `undefined` → 抛 TypeError → processor 死掉 → **永久静音，但节点仍正常回复 port 消息，所以 `load()` 成功、A/B 正常、任何地方都不报错**。

这个 bug 极难被自动化测试发现：它只在 AudioContext 处于 **running** 时触发，而 CI 式测试用 `setInputFiles` 注入文件（不算用户手势），context 是 suspended，worklet 根本不会被调度。`npm run test:worklet` 专门覆盖这个场景。

`src/lib/engine.ts` 里的 `probeEngine()` 是第二道防线：加载前渲染一段已知测试音并检查峰值，失败就抛明确错误，把静默失败变成可见报错。

**2. `schedule` 的字段是 `outputTime`，不是 `output`。** README 写的是 `output`，但源码读的是 `outputTime`，传 `output` 会被静默忽略。

另注：`start()` 和配置参数**必须合并成一次 schedule**。节点的自身延迟大于 50 ms，分两次调用会让后者把前者 `pop` 掉，算出负的起始位置。


## 交互

| 操作 | 快捷键 |
|---|---|
| 播放 / 暂停 | `空格` |
| 调性 ±1 半音 | `←` `→` |
| 调性 ±1 八度 | `Shift` + `←` `→` |
| 速度 ±1% | `↑` `↓` |
| 对比原声 | `Tab` |
| 复位 | `0` |
| 循环播放开关 | `L` |
| 框选循环区间 | `Shift` + 拖动波形 |
**模式**：`独立` 表示变速只改速度；`黑胶` 表示像黑胶机一样变速会带掉音高，调性滑块在此基础上继续叠加。两者的区别就是竞品全都只给了 (key, speed) 空间里的一条一维对角线。

**共振峰保持默认关闭**——它存在的意义是避免花栗鼠效应，而花栗鼠正是这个工具的卖点。

## 许可注意

- `signalsmith-stretch` 声明 MIT，但 **npm 包里没有附 LICENSE 文件**（上游 [issue #29](https://github.com/Signalsmith-Audio/signalsmith-stretch/issues/29)），需从仓库取 `LICENSE.txt`。
- 计划中的 M2 导出若使用 `@mediabunny/mp3-encoder`，其中内嵌的 LAME 是 LGPL，需要在 credits 里给 [lame](https://lame.sourceforge.io/license.txt) 链接。
