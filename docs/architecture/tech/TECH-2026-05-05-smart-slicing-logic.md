> Migrated from `docs/requirements/2026-05-05-smart-slicing-logic.md` on 2026-06-24.
> Owner: SDKWork maintainers

# 智能切片功能逻辑处理文档

日期：2026-05-05
状态：待产品确认
范围：`@sdkwork/autocut-slicer` 智能切片工作台、首页入口、任务详情展示、Tauri 原生切片命令。

## 1. 功能定位

智能切片当前定位为桌面端本地可信视频的自动高光片段生成流程。

用户从首页或切片工作台选择视频后，系统创建“视频切片”任务，导入本地视频到 AutoCut 媒体沙箱，尽量使用本地语音转写生成时间轴，再调用 OpenAI-compatible LLM 规划高光片段。LLM 输出只作为候选计划，前端服务会进行排序、时长约束、空白段补齐和固定数量归一化，最终把确定性的 `clips` 提交给 Tauri 原生命令。原生命令使用 FFmpeg 逐段切出 MP4、生成缩略图，并在有真实转写片段且用户启用字幕时生成 SRT 字幕文件。

当前代码没有实现真正的云端 URL 拉取切片。页面允许从首页输入 URL 并带到 `/slicer?url=...`，服务层也允许 `http/https` URL 通过 source 校验，但后续执行仍要求本地可信文件路径和原生命令能力。仅提交 URL 时会创建任务，然后因缺少本地可信源而进入失败状态。

## 2. 相关代码入口

| 层级 | 文件 | 关键逻辑 |
| --- | --- | --- |
| 首页入口 | `packages/sdkwork-autocut-home/src/pages/HomePage.tsx` | `handleStartSmartSlice` 优先调用桌面文件选择；`handleSubmitSourceUrl` 跳转 URL 模式 |
| 切片页面 | `packages/sdkwork-autocut-slicer/src/pages/SlicerPage.tsx` | 初始化来源、参数配置、预览、提交 `processVideoSlice` |
| 切片服务 | `packages/sdkwork-autocut-slicer/src/service/slicerService.ts` | 任务创建、导入、可选转写、LLM 规划、归一化、调用原生切片、完成任务 |
| 共享类型 | `packages/sdkwork-autocut-types/src/index.ts` | `VideoSliceParams`、`TaskSliceResult`、任务状态与任务类型 |
| Native Client | `packages/sdkwork-autocut-services/src/service/native-host-client.service.ts` | `importMediaFile`、`transcribeMedia`、`sliceVideo` 等 typed contract |
| 任务读取 | `packages/sdkwork-autocut-services/src/service/tasks.service.ts` | 优先读取 native `ops_task`，映射 `sliceResults` 给前端 |
| 原生命令 | `packages/sdkwork-autocut-desktop/src-tauri/src/commands.rs` | 暴露 `autocut_slice_video` |
| 原生执行 | `packages/sdkwork-autocut-desktop/src-tauri/src/media_runtime.rs` | 校验 clips、FFmpeg 切片、缩略图、字幕、落库 |
| 结果展示 | `packages/sdkwork-autocut-tasks/src/pages/TaskDetailPage.tsx` | 切片列表、缩略图、选中预览、下载 |

## 3. 用户入口与页面流程

### 3.1 首页本地视频入口

首页主 banner 点击后执行 `handleStartSmartSlice`：

1. 优先调用 `selectAutoCutTrustedLocalVideoFile()` 打开 Tauri 桌面文件选择器。
2. 用户取消选择时直接返回，不进入切片页。
3. 选择成功后，把原生返回的 `{ sourcePath, name, byteSize, mediaType, mimeType }` 转成 File-compatible 的 trusted file。
4. 跳转到 `/slicer`，通过 router state 传入 `initialFile`。
5. 如果桌面 trusted chooser 不可用，则降级触发隐藏的 `<input type="file" accept="video/*">`。
6. 浏览器 fallback 选择的普通 File 也会进入 `/slicer`，但它没有可信本地路径，后续不能执行真实 native 切片。

代码参考：`HomePage.tsx:63`、`HomePage.tsx:84`。

### 3.2 首页 URL 入口

首页“云端直拉解析”输入框执行 `handleSubmitSourceUrl`：

1. 输入非空时跳转到 `/slicer?url=<encoded-url>`。
2. 输入为空时跳转到 `/slicer`。
3. URL 参数只进入切片页面状态 `sourceUrl`，当前不进行云端下载或远程解析。

代码参考：`HomePage.tsx:50`。

### 3.3 切片工作台初始化

`SlicerPage` 初始化时读取：

1. `searchParams.get('url')` 作为 `initialSourceUrl`。
2. `location.state.initialFile` 作为 `initialFile`。
3. `file` 初始为 `initialFile`。
4. `sourceUrl` 初始为 `initialSourceUrl`。
5. 默认预览视频为 sample video。
6. 如果 `file` 带可信 `sourcePath/path`，通过 Tauri `convertFileSrc` 创建预览 URL。
7. 如果是普通浏览器 File，使用 object URL 预览。

代码参考：`SlicerPage.tsx:36`、`SlicerPage.tsx:41`、`SlicerPage.tsx:195`。

### 3.4 切片工作台参数

当前页面参数包括：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| 内容场景 `mode` | `通用` | 可选：商品直播、单人讲解、双人连线直播、多人连线直播、在线会议、才艺表演、电影、通用 |
| 最小时长 `minDuration` | `15` 秒 | UI 输入 min=5 max=180；服务层最终 clamp 到 5 秒到 10 分钟 |
| 最大时长 `maxDuration` | `90` 秒 | UI 输入 min=10 max=600；服务层最终 clamp 到 5 秒到 10 分钟 |
| LLM 模型 `llmModel` | `deepseek-v4-flash` 后被设置中心配置覆盖 | 页面展示中央模型列表，服务层实际调用默认 runtime model |
| 基础分段策略 `baseAlgorithm` | `nlp` | 可选 nlp / pause / scene；传入 LLM prompt，目前不是本地算法实现 |
| 高光提取引擎 `highlightEngine` | `emotion` | 可选 emotion / keyword / motion；传入 LLM prompt，目前不是本地算法实现 |
| 环境降噪增强 | `true` | 传入 LLM prompt filters，目前不驱动 FFmpeg 降噪 |
| 咳嗽与杂音剔除 | `true` | 传入 LLM prompt filters，目前不驱动本地剔除算法 |
| 重复内容去重 | `false` | 传入 LLM prompt filters，目前不做本地去重算法 |
| 自动生成中英文字幕 | `false` | 仅当本地转写成功且有真实 segments 时生成 SRT |
| 字幕样式 `subtitleStyleId` | `tiktok` | 传入原生命令 input_json，但当前 native SRT 只写纯文本，不使用样式渲染 |

代码参考：`SlicerPage.tsx:18`、`SlicerPage.tsx:48`、`SlicerPage.tsx:305`、`SlicerPage.tsx:758`。

## 4. 提交流程

用户点击“开始一键智能切片”后执行 `handleStart`：

1. 页面设置 `isProcessing=true`。
2. 弹出 toast：“视频智能切片任务已创建并提交”。
3. 组装 `VideoSliceParams`：
   - `mode`
   - `file`
   - `llmModel`
   - `minDuration`
   - `maxDuration`
   - `baseAlgorithm`
   - `highlightEngine`
   - `enableNoiseReduction`
   - `enableCoughFilter`
   - `enableRepeatFilter`
   - `enableSubtitles`
4. 如果页面有 `sourceUrl`，写入 `sliceParams.url`。
5. 如果启用字幕，写入 `subtitleStyleId`。
6. 调用 `processVideoSlice(sliceParams)`。
7. 成功后切换左侧 tab 到“任务列表”，toast：“切片任务分发成功，正在云端解析中”。
8. 失败时上报 diagnostics，尝试切到任务列表，toast：“参数配置异常或服务未响应”。

需要确认：成功 toast 使用“云端解析”文案，但当前执行链路是本地 native FFmpeg，不是云端处理。

代码参考：`SlicerPage.tsx:305`。

## 5. 服务层处理流程

`processVideoSlice(params)` 是当前智能切片的主流程。

### 5.1 来源校验

服务首先调用：

```ts
validateAutoCutProcessingSource({ ...params, allowExternalUrl: true });
```

规则：

1. 有 `file` 或 `fileId` 时通过。
2. 没有 file/fileId 时，必须有非空 URL。
3. URL 必须可解析，且协议只能是 `http:` 或 `https:`。
4. slicer 允许 URL 只代表校验允许，不代表当前会下载或执行 URL 切片。

代码参考：`processing-source.service.ts:47`、`slicerService.ts:376`。

### 5.2 创建前端任务

校验通过后立即创建本地 `AppTask`：

1. `id = createAutoCutTaskId('slice')`
2. `name = file.name`，否则 URL hostname/URL，否则 `视频切片_<mode>.mp4`
3. `type = 视频切片`
4. `status = pending`
5. `progress = 0`
6. `progressMessage = 任务排队中...`
7. 如果有 `fileId`，写入 `sourceFileId`

然后调用 `addTask(newTask)`。

代码参考：`slicerService.ts:66`、`slicerService.ts:379`。

### 5.3 Native 执行能力判断

任务创建后判断是否能真实切片：

1. 从 `params.file` 读取 trusted source path。
2. 获取 native capabilities。
3. 必须同时满足：
   - 有 trusted source path；
   - `mediaImportCommandReady = true`；
   - `videoSliceCommandReady = true`。
4. 不满足时调用 `failAutoCutUnsupportedNativeProcessingTask(newTask, 'automatic slicing')`，任务变为 failed。

这意味着以下来源当前都会失败：

| 来源 | 是否能真实切片 | 原因 |
| --- | --- | --- |
| Tauri 文件选择器返回的 trusted file | 可以 | 包含可信 `sourcePath/path` |
| Tauri 拖拽后转换的 trusted file | 理论可以 | 包含可信路径 |
| 普通浏览器 `<input type=file>` File | 不可以 | 没有可信本地绝对路径 |
| 仅 `http/https` URL | 不可以 | 当前没有 URL 下载/云端解析实现 |
| asset library 的 `fileId` | 当前不可以 | service 没有根据 fileId 复用 assetUuid 的切片分支 |

代码参考：`slicerService.ts:383`、`processing-source.service.ts:21`。

### 5.4 导入本地视频

满足 native 条件后：

1. 更新任务为 `processing`，进度 15，文案“正在准备本地视频切片...”。
2. 读取设置中心配置的 `outputDirectory`。
3. 调用 `nativeHostClient.importMediaFile({ sourcePath, outputRootDir? })`。
4. 原生命令把用户原始视频复制到 `{outputRootDir}/inputs/`，写入 `media_asset`，返回 `assetUuid`。
5. 后续所有 native 命令只使用 `assetUuid`，不再直接传原始路径。

代码参考：`slicerService.ts:391`、`media_runtime.rs:794`。

### 5.5 可选本地语音转写

导入成功后，服务读取语音转写配置：

1. 如果 capability `speechTranscriptionCommandReady=true`；
2. 并且 `speechTranscriptionToolchainReady=true` 或设置中心 `speechRuntimeConfig.configured=true`；
3. 则尝试调用 `nativeHostClient.transcribeMedia({ assetUuid, language, executablePath, modelPath, outputRootDir? })`。
4. 成功后拿到 `transcriptSegments`，每段包含 `startMs/endMs/text/speaker?`。
5. 失败时只上报 warning diagnostics，不中断切片，继续走无转写 fallback。

代码参考：`slicerService.ts:405`、`slicerService.ts:417`。

### 5.6 智能切片计划生成

服务调用 `createIntelligentSlicePlan(params, transcriptSegments)` 生成 clips。

#### 5.6.1 标准数量

默认固定生成 `DEFAULT_SLICE_COUNT = 5` 个候选切片。

代码参考：`slicerService.ts:28`。

#### 5.6.2 时长归一化

`normalizeSliceDurationMs(seconds)`：

1. 秒转毫秒并四舍五入。
2. 非数字时 fallback 到 15 秒。
3. 最终 clamp 到 `5_000ms` 到 `600_000ms`。

代码参考：`slicerService.ts:79`。

#### 5.6.3 没有转写时的 deterministic plan

`createDeterministicSlicePlan`：

1. 取 `minDuration` 与 `maxDuration` 归一化后的较小值作为每段时长。
2. 片段间距为 `max(durationMs, 10_000ms)`。
3. 生成 5 段：
   - 第 1 段 start=0；
   - 第 2 段 start=spacing；
   - 依此类推；
   - label 为 `高光片段 1..5`。

代码参考：`slicerService.ts:88`。

#### 5.6.4 有转写时的 fallback plan

`createTranscriptAssistedSlicePlan`：

1. 过滤空文本片段。
2. 过滤无效或负数 startMs 的片段。
3. 用每段转写的 `startMs` 和 `endMs-startMs` 形成候选。
4. 时长 clamp 到用户配置的 min/max。
5. label 使用转写文本前 48 个字符。
6. 按 startMs 排序。
7. 逐个 append，避免与已加入片段重叠。
8. 不足 5 段时，用 fallback duration 补齐后续非重叠片段。
9. 如果没有有效转写片段，退回 deterministic plan。

代码参考：`slicerService.ts:102`。

#### 5.6.5 LLM 规划

在 fallback plan 准备好后，服务尝试调用 LLM：

1. 构造 system prompt：要求只返回 JSON array，每个 clip 包含 `startMs`、`durationMs`、`label`。
2. user prompt 包含：
   - `mode`
   - `baseAlgorithm`
   - `highlightEngine`
   - `minDurationMs`
   - `maxDurationMs`
   - `requestedClipCount = 5`
   - filters：降噪、咳嗽过滤、去重、字幕
   - `transcriptAssisted`
   - 最多前 80 条 `transcriptTimeline`
3. 通过 approved AI SDK bridge 调 OpenAI-compatible chat completion。
4. 如果 LLM 调用失败，直接使用 fallback plan。

注意：`params.llmModel` 当前被页面传入，但 `createAutoCutOpenAiCompatibleChatCompletion` 调用没有显式传 `model: params.llmModel`，实际模型来自 settings runtime config。页面选择的模型可能没有真正生效，除非设置中心 runtime model 同步为同一个模型。

代码参考：`slicerService.ts:268`、`llm.service.ts:41`、`vercel-ai-sdk-bridge.service.ts:32`。

#### 5.6.6 LLM 输出解析和归一化

`parseLlmSlicePlan`：

1. 从返回文本中截取第一个 `[` 到最后一个 `]`。
2. JSON.parse。
3. 只取前 5 个。
4. 每项必须有有效非负 `startMs` 和有效 `durationMs`。
5. `durationMs` clamp 到 min/max。
6. label 为空则补 `高光片段 N`。
7. 如果没有有效项，回退 fallback plan。
8. 有有效项时进入 `normalizeCandidateSlicePlan`。

`normalizeCandidateSlicePlan`：

1. 过滤无效候选。
2. 按 startMs 排序。
3. 对候选前的空白区间，用 fallback duration 补齐非重叠片段。
4. 只有 candidate.startMs 大于等于当前已占用结束点时才加入，避免重叠。
5. 不足 5 段时从最后结束点继续补齐。

代码参考：`slicerService.ts:157`、`slicerService.ts:224`。

### 5.7 调用原生切片

生成 `clips` 后：

1. 更新任务进度 70，文案“正在渲染视频片段...”。
2. 调用 `nativeHostClient.sliceVideo`：
   - `assetUuid`
   - `clips`
   - `outputFormat: 'mp4'`
   - `outputRootDir?`
   - 如果启用字幕且 `transcriptSegments.length > 0`，附带：
     - `subtitleFormat: 'srt'`
     - `subtitleStyleId?`
     - `subtitleSegments`
3. 如果没有真实转写片段，即使用户启用字幕，也不会生成伪字幕。

代码参考：`slicerService.ts:439`、`slicerService.ts:445`。

### 5.8 完成前端任务和资产

原生返回 `nativeResult` 后：

1. 使用 `nativeResult.taskUuid` 作为 durable task id。
2. `sourceFileId = importedMedia.assetUuid`。
3. 将每个 native slice 转成 `TaskSliceResult`：
   - `id = artifactUuid`
   - `name = <任务名>_<label>.mp4`
   - `duration = durationMs / 1000`
   - `size = byteSize`
   - `resolution = 1080P` 固定值
   - `thumbnailUrl = convertFileSrc(thumbnailArtifactPath)`
   - `url = convertFileSrc(artifactPath)`
   - `subtitleUrl/subtitleFormat` 可选
4. 每个 slice 写入一个 `AppAsset`，type 为 `video`。
5. 写入成功消息“视频切片完成”。
6. 更新原始前端任务为 completed：
   - `id = native taskUuid`
   - `progress = 100`
   - `progressMessage = 视频切片完成。`
   - `completedAt`
   - `sourceFileId`
   - `resultCount`
   - `generatedAssetIds`
   - `sliceResults`

代码参考：`slicerService.ts:319`、`slicerService.ts:355`、`slicerService.ts:465`、`slicerService.ts:476`。

## 6. 原生切片执行逻辑

### 6.1 命令契约

Tauri 命令：

```rust
autocut_slice_video(request: AutoCutVideoSliceRequest) -> AutoCutVideoSliceResult
```

request 字段：

| 字段 | 说明 |
| --- | --- |
| `assetUuid` | 必填，必须是已导入 `media_asset` |
| `clips` | 必填，数组项为 `startMs/durationMs/label` |
| `outputFormat` | 当前只支持 `mp4` |
| `outputRootDir` | 可选，设置中心输出目录 |
| `subtitleFormat` | 可选，当前只支持 `srt` |
| `subtitleStyleId` | 可选，目前只持久化在 input_json |
| `subtitleSegments` | 可选，真实转写片段 |

代码参考：`commands.rs:128`、`media_runtime.rs:244`。

### 6.2 原生校验

原生命令执行前会：

1. 通过 `assetUuid` 读取 `media_asset`。
2. 确认 sandbox input 文件存在。
3. 校验 `outputFormat` 只能是 `mp4`。
4. 校验 `subtitleFormat` 为空或 `srt`。
5. 校验 `clips`：
   - 至少 1 个；
   - 最多 20 个；
   - `startMs >= 0`；
   - `durationMs > 0 && durationMs <= 600000`；
   - label 只保留 ASCII 字母数字、`-`、`_`、空白，并截断到 60 字符；为空时用 `Highlight N`。
6. 清洗 `subtitleSegments`：
   - 过滤空文本；
   - 过滤 `endMs <= startMs`；
   - 文本截断到 500 字符；
   - speaker 截断到 80 字符。
7. 用 FFmpeg 读取源视频时长，并把超出视频总时长的 clip 过滤掉；尾部超长 clip 会缩短到剩余时长。
8. 如果所有 clip 都在源视频时长之外，已经创建的 native `ops_task` 会标记 failed，不允许 completed 且 0 slices。

代码参考：`media_runtime.rs:1613`、`media_runtime.rs:1632`、`media_runtime.rs:1692`、`media_runtime.rs:1719`。

### 6.3 输出目录和落库

每次 native 切片创建一个 `ops_task` 和一个任务输出目录：

```text
{outputRootDir}/tasks/{task_uuid}/
```

`ops_task.input_json` 记录：

1. `assetUuid`
2. `outputFormat`
3. `clips`
4. `requestedClips`
5. `subtitleFormat`
6. `subtitleStyleId`
7. `subtitleSegments`
8. `subtitleSegmentCount`
9. `outputRootDir`，如果配置过

代码参考：`media_runtime.rs:2226`。

### 6.4 FFmpeg 执行

对每个 clip 依次执行：

1. 生成 MP4：
   - `-ss <start>`
   - `-i <input>`
   - `-t <duration>`
   - `-map 0:v:0`
   - `-map 0:a?`
   - `-c:v libx264`
   - `-preset veryfast`
   - `-crf 23`
   - `-c:a aac`
   - `-b:a 128k`
   - `-movflags +faststart`
2. 生成 JPEG 缩略图：
   - 截取 clip 中点帧；
   - `scale=320:-2:flags=lanczos`
   - `-q:v 3`
3. 如果启用 SRT 且存在重叠转写片段，写 SRT 字幕文件：
   - 只取与当前 clip 时间范围有 overlap 的 segments；
   - 字幕时间戳转换为相对当前切片开始时间；
   - 文本格式为 `speaker: text` 或 `text`。
4. FFmpeg progress 会写入 native `ops_task.progress`，处理中范围 1..99，完成后才到 100。

代码参考：`media_runtime.rs:3712`、`media_runtime.rs:3779`、`media_runtime.rs:3878`、`media_runtime.rs:3937`。

### 6.5 原生结果

每个 slice 返回：

| 字段 | 说明 |
| --- | --- |
| `artifactUuid` | 视频切片 artifact id |
| `artifactPath` | MP4 文件路径 |
| `thumbnailArtifactUuid` | 缩略图 artifact id |
| `thumbnailArtifactPath` | JPG 文件路径 |
| `subtitleArtifactUuid` | 可选，字幕 artifact id |
| `subtitleArtifactPath` | 可选，SRT 文件路径 |
| `taskOutputDir` | 所属输出目录 |
| `byteSize` | MP4 文件大小 |
| `thumbnailByteSize` | JPG 文件大小 |
| `subtitleByteSize` | 可选，SRT 文件大小 |
| `subtitleFormat` | 可选，srt |
| `format` | mp4 |
| `startMs` | 实际开始毫秒 |
| `durationMs` | 实际时长毫秒，可能因视频尾部被缩短 |
| `label` | 清洗后的 label |

同时原生写入：

1. `media_artifact`：每个视频切片一条。
2. `media_artifact`：每个缩略图一条。
3. `media_artifact`：每个有内容的字幕一条。
4. `ops_task.output_json`：包含 `taskOutputDir`、`sliceCount`、`sliceResults`。
5. `ops_task_event`：started/progress/completed/failed 等审计事件。

代码参考：`media_runtime.rs:6031`、`media_runtime.rs:6392`、`media_runtime.rs:6472`、`media_runtime.rs:6556`。

## 7. 任务读取与结果展示

### 7.1 任务数据来源

`getTasks()` 优先尝试读取 native tasks：

1. 如果 capability `nativeTaskQueryCommandReady=true`，调用 `listNativeTasks`。
2. 将 native `ops_task` snapshot 映射为前端 `AppTask`。
3. 对视频切片任务，从 `output_json.sliceResults` 映射出前端 `TaskSliceResult`。
4. 如果 native task query 不可用，则回退读取浏览器 local storage 里的 tasks。

代码参考：`tasks.service.ts:62`、`tasks.service.ts:111`、`tasks.service.ts:163`、`tasks.service.ts:334`。

### 7.2 切片详情页

任务详情页对 `视频切片`：

1. 左侧显示“生成的切片文件 (N)”。
2. 每个切片显示缩略图、名称、大小、固定分辨率 `1080P`、下载按钮。
3. 点击切片后，右侧 `<video>` 播放对应 `slice.url`。
4. 默认选中第一个切片。
5. 切片为空时显示“暂无生成文件”。
6. 当前详情页没有展示或下载 subtitleUrl 的专门入口。

代码参考：`TaskDetailPage.tsx:64`、`TaskDetailPage.tsx:129`、`TaskDetailPage.tsx:150`、`TaskDetailPage.tsx:199`。

## 8. 状态流与异常分支

### 8.1 正常状态流

```text
用户选择 trusted 本地视频
  -> /slicer 初始化 file 和预览
  -> 用户配置切片参数
  -> 创建前端 AppTask: pending 0%
  -> native import: processing 15%
  -> 可选 speech transcription: processing 35%
  -> LLM/fallback 规划: processing 45%
  -> native FFmpeg 切片: processing 70%，native progress 持续推进
  -> native ops_task completed 100%
  -> 前端 AppTask completed 100%
  -> 资产、消息、任务详情展示
```

### 8.2 LLM 不可用

LLM 不可用包括：

1. 未配置 baseUrl/model/API key；
2. approved AI SDK bridge 不可用；
3. native LLM HTTP command 不可用；
4. API 调用失败；
5. LLM 返回不可解析 JSON。

处理结果：不失败，使用转写辅助 fallback plan 或 deterministic plan。

### 8.3 本地语音转写不可用

本地语音转写不可用包括：

1. speech command 不可用；
2. speech toolchain 未配置；
3. Whisper-compatible 可执行文件或模型路径错误；
4. 转写命令执行失败。

处理结果：不失败，诊断 warning，继续无转写切片计划。启用字幕时不会生成伪字幕。

### 8.4 Native 条件不满足

如果缺少 trusted source path、media import command 或 video slice command：

1. 已创建的前端任务被标记 failed。
2. 错误信息：`AutoCut automatic slicing requires a trusted local desktop media file and the native desktop processing command.`
3. 页面切到任务列表，详情页展示失败状态。

### 8.5 原生 FFmpeg 失败

如果原生命令执行中失败：

1. native `ops_task` 写 failed 和审计事件。
2. 前端 `failAutoCutProcessingTask(newTask.id, String(error))` 标记最初创建的前端任务 failed。
3. 失败信息写入 `errorMessage`。

### 8.6 全部片段超出视频时长

如果 source-duration 过滤后没有任何可用 clip：

1. native `ops_task` 标记 failed。
2. 不生成任何 slice artifact。
3. 不允许 completed 且 `sliceCount=0`。

## 9. 当前逻辑与产品文案不一致点

以下点建议产品确认：

1. 首页和成功 toast 使用“云端直拉解析 / 云端解析”文案，但当前真实可用路径是本地 Tauri + FFmpeg。
2. URL 输入可以进入切片页，但不能实际执行远程视频切片。
3. 页面 LLM 下拉框选择了模型，但服务层实际使用 settings runtime model，未把 `params.llmModel` 传给 LLM 调用。
4. “基础分段策略 / 高光提取引擎 / AI 智能过滤”目前主要作为 LLM prompt 字段，不是本地可验证算法。
5. “自动生成中英文字幕”当前实际输出是基于真实转写片段的 SRT 字幕文件，不做中英翻译，也不做字幕样式烧录。
6. `subtitleStyleId` 当前只传入 native input_json，SRT 输出未使用花字样式。
7. 任务详情页可播放和下载视频切片，但没有字幕文件入口。
8. `resolution` 当前固定写 `1080P`，不是从输出文件探测得到。
9. `fileId` 字段存在于类型和任务 trace 中，但智能切片服务当前没有资产库 fileId 到 native assetUuid 的处理分支。

## 10. 待确认需求清单

请按以下条目确认产品预期。

| 编号 | 待确认项 | 当前实现 | 建议确认方向 |
| --- | --- | --- | --- |
| Q1 | 智能切片是否必须支持 URL/云端直拉 | URL 只校验和带参，最终失败 | 若一期只做本地，隐藏/改文案；若要云端，需要新增下载/解析/asset 导入链路 |
| Q2 | 首页普通浏览器文件 fallback 是否保留 | 可选文件但不能真实切片 | 桌面端建议保持 trusted chooser 为主；fallback 只用于非桌面提示或禁用提交 |
| Q3 | 页面 LLM 模型选择是否应即时生效 | 当前实际使用 settings runtime model | 应将 `params.llmModel` 传入 LLM 调用，或移除页面模型选择，统一由设置中心管理 |
| Q4 | 切片数量是否固定 5 个 | 固定 5 个 | 如需用户可配，应新增 `sliceCount` 参数和 UI |
| Q5 | min/max 时长冲突如何处理 | 使用两者较小值作为 fallback duration；候选 duration clamp 到 min/max | 建议 UI 校验 `min <= max`，否则提示用户 |
| Q6 | “降噪/咳嗽/去重/分段策略/高光引擎”是否需要真实算法 | 当前只是 prompt 信号 | 若要真实效果，需要定义本地/云端算法边界和可验收指标 |
| Q7 | 字幕是否要中英双语、样式化或烧录到视频 | 当前仅生成可选 SRT 文件 | 明确是外挂 SRT、烧录字幕、双语字幕，还是工作台花字编辑能力 |
| Q8 | 任务结果是否需要展示字幕下载 | 当前详情页不展示 subtitleUrl | 如果字幕是产品功能，应在详情页增加字幕下载入口 |
| Q9 | 切片 label 是否允许中文保留到文件/展示 | 原生 label 清洗只保留 ASCII，LLM 中文 label 会被替换/清洗 | 如果要中文标题，需要调整 native label sanitizer 与文件名安全规则 |
| Q10 | 资产库视频是否可以再次智能切片 | 类型支持 `fileId`，实现缺分支 | 需要定义 assetUuid 复用、导入状态和权限边界 |
| Q11 | 分辨率展示是否要求真实 | 当前固定 `1080P` | 若要求真实，应 native 返回或前端探测输出分辨率 |
| Q12 | 失败任务用户是否能重试/取消 | native 有 retry/cancel contract，切片页未暴露 | 若需要，任务列表/详情页增加取消、重试操作 |

## 11. 推荐的一期验收口径

如果一期目标是“本地桌面智能切片可用”，建议按以下口径确认：

1. 仅承诺 Tauri 桌面 trusted local video。
2. 首页 URL/云端文案暂时改为未上线或隐藏，避免用户提交必失败任务。
3. 智能计划 = 本地转写辅助 + LLM 候选 + deterministic fallback，不承诺独立降噪/去咳嗽/去重算法。
4. 固定输出 5 个 MP4 切片，每段遵守 5 秒到 10 分钟边界，并在源视频尾部自动缩短。
5. 每个切片生成 JPG 缩略图。
6. 启用字幕时，仅当本地转写成功才生成 SRT；没有真实转写不生成假字幕。
7. 任务详情支持切片预览和下载；字幕下载、真实分辨率、URL 云端解析、可配置切片数量作为后续需求。

## 12. 建议后续实现顺序

1. 先确认 URL/云端入口是否属于一期范围。
2. 修正页面文案和禁用条件，避免普通 File / URL 进入必失败流程。
3. 明确 LLM 模型来源：页面选择优先或设置中心统一。
4. 补充 min/max 校验和错误提示。
5. 如果字幕是正式功能，任务详情增加 SRT 下载入口。
6. 如果要云端 URL 切片，单独设计“URL 解析 -> 下载/导入 -> assetUuid -> 现有切片流程”的闭环。

