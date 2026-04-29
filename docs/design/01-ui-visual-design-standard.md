# sdkwork-video-cut UI Visual Design Standard

日期：2026-04-26
状态：draft

## 1. 设计定位

`sdkwork-video-cut` 是专业视频剪辑工作台，不是营销页面，也不是娱乐化创作社区。界面应安静、密集、清晰、可扫描，优先服务重复操作、审阅、批处理和问题排障。

首屏必须是可操作体验：项目、任务、导入入口或工作台，不做 hero landing page。

## 2. 设计原则

- 工作台优先：用户进入后能立即导入、分析、审阅或继续任务。
- 状态清晰：AI、STT、FFmpeg、字体、存储、队列、任务状态必须一眼可见。
- 设置中心完整：模型和语音配置是核心产品能力，不藏在高级选项里。
- 高密度但不拥挤：表格、列表、时间轴、参数面板使用稳定尺寸和清晰分组。
- 不做前端媒体处理：前端只预览和编辑计划，所有分析/渲染由 host 完成。
- 不使用装饰性渐变、发光球、卡片套卡片或营销式大版头。
- 图标优先：工具按钮优先使用 lucide-react 图标，悬浮 tooltip 解释含义。

## 3. 视觉语言

### 3.1 色彩

推荐使用中性色工作台底色，少量状态色和字幕高亮色。

| Token | 用途 | 建议 |
| --- | --- | --- |
| `surface.app` | 应用背景 | 接近白或浅灰，不使用单一深蓝/紫色主题。 |
| `surface.panel` | 面板背景 | 比 app 背景略高一级。 |
| `surface.raised` | 弹层、菜单 | 与 panel 有 1px 边界差。 |
| `border.subtle` | 分隔线 | 低对比灰。 |
| `text.primary` | 主要文字 | 接近黑。 |
| `text.secondary` | 辅助文字 | 中灰。 |
| `accent.primary` | 主操作 | 稳定蓝或青，不大面积铺色。 |
| `accent.warning` | 警告 | 琥珀色。 |
| `accent.danger` | 失败/删除 | 红色。 |
| `accent.success` | 成功 | 绿色。 |
| `caption.highlight` | 字幕高亮 | 黄色，用于预览和 subtitle style。 |

禁止：

- 大面积紫色/蓝紫渐变。
- 米色/棕色/深蓝单色主题。
- 纯装饰 orb、bokeh、发光背景。
- 用颜色作为唯一状态表达。

### 3.2 字体

- UI 字体：系统无衬线字体栈。
- 数字和时间码：等宽字体。
- 字幕预览：默认展示极宋或 fallback 字体。
- 字号不随 viewport 宽度线性缩放。
- 按钮、表格、标签必须保证中文不溢出。

### 3.3 圆角和阴影

- 普通控件圆角 6px。
- 卡片/面板圆角不超过 8px。
- 不允许卡片套卡片。
- 页面 section 不做漂浮卡片，工作台区域用分隔线、面板和工具栏组织。
- 阴影只用于弹层、菜单、拖拽对象，不用于大面积装饰。

## 4. 应用框架

```text
Top Bar
  product switch / project title / global status / settings / doctor

Left Rail
  Projects
  Workbench
  Queue
  Results
  Diagnostics
  Settings

Main Workspace
  route content

Right Utility Drawer
  contextual inspector / logs / task details
```

规则：

- 左侧导航使用图标 + 短文本。
- 顶部显示当前项目、部署模式、host 状态、AI/STT/FFmpeg readiness。
- 设置中心必须是主导航一级入口。
- 诊断中心也必须是一级入口或设置中心固定入口。

## 5. 页面布局

### 5.1 Home / Projects

布局：

```text
Top action row: New Project | Import Video | Open Workspace | Run Doctor

Recent projects table
Active tasks table
Capability summary strip
```

视觉：

- 使用表格和列表，不使用营销卡片墙。
- 每个项目行显示名称、路径、最近任务、最后更新时间、状态。
- capability summary 使用紧凑状态 pill，图标 + 文本 + tooltip。

### 5.2 Workbench

桌面布局：

```text
┌─────────────────────────────────────────────────────────────┐
│ Toolbar: import | analyze | review | render | export         │
├───────────────┬───────────────────────────────┬─────────────┤
│ Clip list     │ Preview + subtitle overlay    │ Inspector   │
│ filters       │ Timeline summary              │ settings    │
│ batch select  │ Transcript / plan tabs        │ diagnostics │
└───────────────┴───────────────────────────────┴─────────────┘
```

移动/窄屏布局：

- 左侧列表、预览、Inspector 变成 tabs。
- 主要操作固定在底部 action bar。
- 视频预览保持 9:16 aspect ratio，不挤压字幕。

关键区域：

- 预览区使用 HTML5 video。
- 视频外框显示 9:16 输出安全框。
- 字幕 overlay 必须接近最终 ASS 效果。
- 时间轴只做片段级概览，不做完整 NLE。
- Inspector 使用 tabs：Plan、Subtitle、Cover、Render、Diagnostics。

### 5.3 Queue

布局：

- 顶部：状态筛选、暂停新任务、并发状态。
- 主体：任务表格。
- 右侧抽屉：选中任务事件、stage、日志、重试。

表格列：

- task name。
- type。
- status。
- current stage。
- progress。
- duration。
- updated at。
- actions。

actions 必须至少包含 Select、Cancel、Delete。Select 切换 Workbench 当前任务上下文；Cancel/Delete 使用图标+文本按钮，不使用纯图标；选中行使用轻量背景色，同时不能只靠颜色表达，必须保留可访问状态。

### 5.4 Results

布局：

- 左侧：render 列表。
- 中间：视频预览和封面预览 tabs。
- 右侧：artifact manifest、参数、日志、完整性。
- MVP 当前实现可采用纵向布局：视频预览、Delivery package evidence panel、artifact 下载列表依次排列；Delivery package 必须展示 manifest schema、source range、output spec、render graph preset、subtitle cues、hash 完整性。

操作：

- Open output folder。
- Download artifact。
- Re-render。
- Copy path。
- Export manifest。

### 5.5 Diagnostics

布局：

- 顶部 status summary。
- 左侧 check list。
- 右侧 evidence / action hint。
- 顶部提供 Run doctor 和 Export diagnostics 操作。
- 导出后显示下载卡片：bundle version、sourceMedia/transcript scope、文件名、大小、`redaction verified`。
- 下载入口使用 `FileDown` 图标 + 文本链接 `Download diagnostics JSON`，不得只显示图标。

状态：

- pass：绿色 check。
- warn：琥珀 alert。
- fail：红色 alert。
- skipped：灰色 minus。

## 6. 设置中心设计

设置中心采用左侧分组导航 + 右侧设置表单 + 底部 sticky action bar。

```text
Settings
  Overview
  AI Providers
  Speech To Text
  Subtitle And Caption
  Media Tools
  Output Presets
  Assets
  Storage
  Runtime
  Security
  Diagnostics
  About
```

Settings > Diagnostics 必须与一级 Diagnostics 页面共享同一下载卡片和脱敏证据展示，避免两个入口产生不同导出语义。

### 6.1 设置页通用结构

```text
Header
  title
  short status
  last validated at
  reset / test / docs action

Form sections
  section title
  fields
  inline validation
  capability warning

Sticky footer
  unsaved changes
  save
  discard
  test changes
```

规则：

- Secret 输入使用 masked input，保存后只显示 configured 状态。
- 受 server policy 锁定的字段只读，显示 lock 图标和来源。
- 每个字段显示是否需要 restart、是否影响新任务、是否影响当前任务。
- 错误在字段附近显示，页面顶部只显示摘要。

### 6.2 AI Providers 页面

推荐布局：

```text
Provider status strip
Connection
Model
Structured Output
Timeout And Retry
Advanced Network
Test Result
```

组件：

- Enable toggle。
- Base URL input。
- API key secret input。
- Model combo box。
- Structured output segmented control。
- Temperature slider + numeric input。
- Timeout stepper。
- Test buttons：connection、structured output、model list。

视觉要求：

- 测试结果用 evidence panel，不用 toast 承载全部信息。
- API key 不显示明文，不支持复制已保存 key。
- base URL 显示 host 级别摘要，避免把完整 secret query 显示在日志中。

### 6.3 Speech To Text 页面

推荐布局：

```text
Provider status strip
Connection
Transcription Model
Language And Timestamps
Fallback
Test Audio
```

组件：

- Provider toggle。
- Provider profile select：`openai-audio-transcriptions`、`volcengine-bigasr-flash`、`aliyun-qwen-asr`。
- Base URL/API key，可选择复用 AI provider。
- Model combo box。
- Resource ID text field：火山 BigASR Flash 使用，默认 `volc.bigasr.auc`；其他 profile 保持可见但标注为非 secret 元数据。
- Language select，默认 zh。
- Timestamp granularity checkbox group，按 capability disabled。
- Diarization toggle，按 capability disabled。
- Local whisper fallback toggle，默认 off。
- Test sample button。

视觉要求：

- word timestamp 和 diarization 不支持时显示 disabled + action hint。
- provider conformance 结果必须显示 `stt.provider.bridge`、canonical request/response、vendor endpoint 和 credentialStatus，不显示 API key、Authorization 或厂商原始响应。
- STT 测试结果显示 transcript snippet、segment count、duration、provider latency。

### 6.4 Subtitle And Caption 页面

推荐布局：

```text
Style controls          Live preview
Font                    9:16 preview frame
Position                subtitle overlay
Shadow                  safe area guide
Highlight
Import/Export
```

组件：

- Font selector。
- Font availability badge。
- Size stepper。
- Position segmented control。
- Shadow opacity slider。
- Blur slider。
- Highlight color swatch。
- Max lines stepper。
- Preview text input。

视觉要求：

- 预览必须使用 9:16 frame。
- 黄色高亮必须做对比度检查。
- 字幕不能遮挡底部操作按钮。
- 缺字体时 preview 使用 fallback 并显示 warning。

### 6.5 Media Tools 页面

推荐布局：

```text
Tool inventory table
FFmpeg
ffprobe
ONNX Runtime
Silero VAD model
Temp and concurrency
```

组件：

- Tool path input + browse button，desktop-local 才显示 browse。
- Auto discover button。
- Validate button。
- Version display。
- Capability badge。
- Log path link。

视觉要求：

- 工具缺失按 blocking/non-blocking 分级。
- 不在 UI 中显示原始命令行拼接。

### 6.6 Storage 页面

组件：

- Workspace root path。
- Artifact root path。
- Temp root path。
- Retention days。
- Cleanup policy。
- S3-compatible profile placeholder，未来阶段启用。

视觉要求：

- 路径变更显示影响范围 confirmation。
- server/k8s 模式显示配置来源，不显示 browse。

### 6.7 Runtime And Security 页面

组件：

- Deployment mode read-only badge。
- Bind host/port。
- Auth mode。
- CORS origins。
- Secret provider。
- Diagnostics export scope。
- Redaction policy。

视觉要求：

- 高风险配置用 inline risk panel。
- `0.0.0.0` + no auth 必须显示 fail 状态，不允许保存。

## 7. 组件标准

| 用途 | 组件 |
| --- | --- |
| 主操作 | icon + text button |
| 工具操作 | icon button + tooltip |
| 二元开关 | toggle |
| 多选能力 | checkbox group |
| 模式选择 | segmented control |
| 数值 | slider + number input |
| 路径 | input + browse/test |
| Secret | masked secret field |
| 状态 | badge + icon |
| 长任务 | progress bar + event log |
| 错误 | inline error + action hint |
| 大量任务 | table |
| 片段审阅 | list + preview + inspector |

图标建议使用 lucide-react：

- Settings、SlidersHorizontal、FolderOpen、Upload、Play、Pause、Scissors、Captions、Mic、Brain、Film、Activity、AlertTriangle、CheckCircle、XCircle、RefreshCw、Download、ExternalLink、Lock、EyeOff。

## 8. 状态设计

### 8.1 Empty

- 无项目：显示新建项目、打开工作区、导入视频。
- 无模型：显示去设置 AI Provider。
- 无 FFmpeg：显示去 Media Tools。
- 无任务：显示导入视频。

### 8.2 Loading

- 页面级 loading 不超过首屏主要区域。
- 长任务显示 stage、progress、current action。
- 不用全屏 spinner 阻断设置中心。

### 8.3 Error

错误展示结构：

```text
title
short explanation
action hint
trace id
log path
primary action
secondary action
```

Workbench, Settings Center, and Diagnostics operation errors use a compact evidence panel:

- title: operation-specific, for example `Render task failed` or `Export diagnostics failed`.
- explanation: safe Host message only.
- evidence: error code, HTTP status, trace id, endpoint.
- action: dismiss; detailed logs remain available through redacted artifact links.
- recovery: startup runtime failures also show a `Reload runtime state` secondary action with a refresh icon.
- forbidden: raw FFmpeg stderr, provider raw response, secret values, absolute local media paths.

Queue recovery actions:

- Failed or interrupted rows show `Retry` with `RotateCw`.
- Retry uses stable aria label `Retry task {sourceName}`.
- Retry sits between `Cancel` and `Delete` so destructive actions remain visually separated.

### 8.4 Degraded

能力降级必须明确可用范围：

- AI unavailable：允许手动剪辑、手动字幕。
- STT unavailable：允许导入 transcript。
- FFmpeg unavailable：允许设置和分析准备，不允许渲染。
- Font missing：允许 fallback 渲染，但输出带 warning。

## 9. 时间轴和字幕预览

MVP 时间轴不是完整 NLE。

必须展示：

- clip boundary。
- silence range。
- speech activity。
- transcript sentence。
- selected output segment。
- render duration estimate。

可延后：

- 多轨精剪。
- 波形精细编辑。
- 逐帧关键帧。
- 转场编辑。

## 10. 可访问性

- 所有 icon-only button 必须有 tooltip 和 aria-label。
- 所有表单字段必须有 label。
- 状态不能只靠颜色表达。
- 键盘可完成设置中心主要操作。
- 弹层和抽屉必须有焦点管理。
- 字幕预览颜色必须校验基本对比度。

## 11. 响应式

桌面优先，但不得在窄屏断裂。

| 宽度 | 行为 |
| --- | --- |
| >= 1280px | 三栏工作台。 |
| 900-1279px | 左栏可折叠，Inspector 抽屉。 |
| < 900px | 列表、预览、Inspector 变 tabs，底部 action bar。 |

固定格式元素必须有稳定尺寸：

- 9:16 预览框使用 `aspect-ratio`。
- 工具栏按钮高度固定。
- 状态 badge 不改变行高。
- 表格列有 min/max。

## 12. 文案标准

- 用动作词：导入、分析、审阅、渲染、导出、测试、修复。
- 错误文案必须给下一步。
- 不在应用内写功能宣传文案。
- 不用“智能一键大片”这类营销措辞。
- 设置项文案必须与 runtime config schema 对齐。

## 13. 验收清单

- [ ] 首屏是可操作工作台或任务入口。
- [ ] 设置中心是一级入口。
- [ ] LLM、STT、字幕、媒体工具、输出、存储、安全、诊断都有独立设置分组。
- [ ] Secret 字段不显示明文。
- [ ] UI 不自行探测 capability。
- [ ] UI 不直接调用模型 endpoint 或 FFmpeg。
- [ ] HTML5 video 预览 9:16 框稳定。
- [ ] 字幕预览接近 ASS 输出效果。
- [ ] 缺能力时显示 degraded 状态和 action hint。
- [ ] 所有 icon-only 操作有 tooltip。
- [ ] 移动/窄屏无文字溢出和控件重叠。
