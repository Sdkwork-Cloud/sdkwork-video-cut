> Migrated from `docs/requirements/2026-05-05-smart-slicing-short-video-implementation-review.md` on 2026-06-24.
> Owner: SDKWork maintainers

# 智能切片短视频实现逻辑评审

日期：2026-05-05
状态：待确认
目标：把长视频切成可独立发布到自媒体平台的高连贯短视频，而不是只按时间点机械截取。

## 1. 需求结论

智能切片的核心需求应定义为：

从一条完整视频中识别多个“可独立观看、可独立发布、上下文完整”的短视频片段。每个输出片段必须尽量满足：

1. 有明确开头：观众一进入就知道在讲什么、看什么或卖什么。
2. 有完整主体：片段内部表达连续，不在半句话、半个动作、半个问答中断开。
3. 有自然收尾：至少完成一个观点、一个回答、一个展示、一个剧情/动作节点或一个转化动作。
4. 有自媒体可用性：时长、画幅、字幕、标题、缩略图、下载和预览满足短视频发布流程。
5. 可追溯可重跑：每个成片知道来自源视频哪一段、为什么被选中、有哪些质量评分和风险。

因此，完整实现不应只让 LLM 返回几个 `startMs/durationMs`。正确方式是：

```text
导入视频
  -> 探测音视频元数据
  -> 本地转写和时间轴生成
  -> 可选画面/场景/音频特征分析
  -> 构建原子内容单元
  -> 生成候选短视频窗口
  -> 对候选做高光、完整性、连贯性、平台适配评分
  -> LLM 辅助语义挑选和标题理由生成
  -> 确定性规则修正切点、时长、重叠和边界
  -> 渲染短视频、字幕、缩略图
  -> 成片质检
  -> 写入任务、资产和结果
```

## 2. 当前实现结论

当前代码已经具备真实切片的基础骨架：

1. 桌面端可信本地文件选择。
2. 导入视频到 native media sandbox。
3. 可选本地语音转写。
4. LLM 返回候选 `clips`。
5. 前端服务排序、时长 clamp、补齐固定 5 段。
6. Tauri native 调 FFmpeg 切出 MP4、缩略图和可选 SRT。
7. 任务详情页展示切片并播放。

但当前实现距离“自媒体短视频成片”还有明显差距：

1. 切片仍偏“时间段提取”，不是“内容单元成片”。
2. 候选计划没有显式判断开头上下文、收尾完整性、指代完整性、问答完整性。
3. `baseAlgorithm`、`highlightEngine`、降噪、咳嗽过滤、去重当前主要只是 LLM prompt 字段。
4. 页面 LLM 模型选择没有传入 LLM 调用，实际模型来自设置中心。
5. URL/云端入口文案存在，但当前只有本地 trusted file 能真实切片。
6. 输出固定 5 个，不支持“按视频长度/目标平台/质量阈值”动态决定数量。
7. 画幅预览存在，但 native 输出没有真正按 9:16、1:1、16:9 重新裁剪渲染。
8. 字幕目前是 SRT 文件，不是烧录字幕；也没有中英双语逻辑。
9. 缩略图只是切片中点帧，不是高点击帧或标题封面。
10. 结果页没有展示切片理由、质量分、字幕下载、平台建议标题/标签。

相关现状文档见：
`docs/requirements/2026-05-05-smart-slicing-logic.md`。

## 3. 推荐实现方式

推荐采用“LLM 语义辅助 + 确定性切点守卫”的方案。

### 3.1 方案 A：纯规则切片

规则只基于转写、静音、场景切换和固定时长生成切片。

优点：

1. 成本低。
2. 可预测。
3. 没有模型不可用问题。

缺点：

1. 对内容吸引力判断弱。
2. 容易切出信息完整但不够“爆点”的片段。
3. 标题、发布理由、看点总结能力弱。

适合做 fallback，不适合作为主方案。

### 3.2 方案 B：LLM 辅助规划，规则强约束

先用转写、场景、静音等生成候选窗口，再让 LLM 在候选窗口中选出适合自媒体发布的短视频，并给出标题、理由、主题、风险。LLM 不能直接决定最终切点；最终切点必须经过规则修正和质检。

优点：

1. 语义理解强，能识别完整观点、问答、反转、卖点和剧情节点。
2. 成本可控，因为 LLM 只处理结构化候选和时间轴摘要。
3. 质量稳定，切点由规则兜底，不依赖 LLM 的毫秒级准确性。
4. 可解释，任务结果能展示“为什么切这段”。

缺点：

1. 需要实现候选窗口生成和连续性评分。
2. 需要维护 LLM JSON contract 和 fallback。

推荐采用此方案作为一期完整实现目标。

### 3.3 方案 C：全自动混剪成片

一个短视频可以由多个不连续片段拼接，自动加转场、标题卡、B-roll、音效和字幕。

优点：

1. 成片感最强。
2. 可适配营销号、知识号、剧情混剪等复杂玩法。

缺点：

1. 实现复杂度高，需要 native 支持多段拼接、转场、字幕烧录、音频均衡。
2. 连贯性要求更高，不只是切片，而是自动剪辑。
3. 质检和失败回退复杂。

建议作为后续“智能成片/混剪”能力，不作为当前切片的一期目标。

## 4. 一期目标边界

一期建议先做“连续片段短视频切片”，即每个输出短视频来自源视频中的一个连续时间区间。

不建议一期做多段拼接混剪。原因是当前 native command `autocut_slice_video` 的契约就是 `startMs + durationMs` 的连续片段，基础设施已支持；多段拼接需要新增 `segments[]`、转场、音频拼接、字幕重排和质检流程。

一期输出定义：

1. 每个短视频是源视频的一段连续区间。
2. 每段必须尽量完整表达一个独立内容单元。
3. 支持多个切片结果，数量由用户配置或系统按质量阈值决定。
4. 每段输出 MP4、缩略图、可选字幕、切片理由和元数据。
5. 支持不同场景、算法、引擎和平台目标影响切片策略。

## 5. 输入选项体系

当前 UI 已有部分选项，但语义需要补齐。建议将选项分成 6 类。

### 5.1 内容场景 `mode`

内容场景决定“什么样的片段算完整且适合发布”。

| 场景 | 切片目标 | 连贯性要求 | 推荐策略 |
| --- | --- | --- | --- |
| 商品直播 | 切出能单独转化的卖点片段 | 必须包含商品对象、卖点、价格/权益/对比/行动号召中的至少两类 | 偏关键词和情绪，过滤重复叫卖，时长 20-60 秒 |
| 单人讲解 | 切出一个完整知识点或观点 | 必须有问题/结论、解释、总结；避免从“所以/这个/刚才”开头 | 偏 NLP，时长 30-120 秒 |
| 双人连线直播 | 切出完整问答或对话冲突 | 必须包含问题和回答，不能只切半个 speaker turn | 偏说话人轮次和情绪，时长 30-90 秒 |
| 多人连线直播 | 切出一个明确话题下的多人讨论 | 必须保持话题一致，避免多人抢话造成断裂 | 偏 speaker clustering，选择最清晰的对话窗口 |
| 在线会议 | 切出决策、结论、行动项或观点总结 | 必须包含上下文、结论和责任/动作，不追求情绪高点 | 偏 NLP 和关键词，时长 45-180 秒 |
| 才艺表演 | 切出完整表演段落或高潮段 | 必须避免音乐/动作中间硬切，尽量按乐句、动作完成点、镜头边界切 | 偏 scene/motion/audio，时长 30-120 秒 |
| 电影 | 切出完整剧情/冲突/反转节点 | 必须有起承转合或至少 setup-payoff；避免半句台词和半个镜头动作 | 偏 scene + emotion，时长 30-180 秒 |
| 通用 | 平衡提取高光短片 | 以语义完整、非重叠、可发布为主 | 组合 NLP、情绪、场景和静音边界 |

### 5.2 输出平台/画幅

当前页面只有预览层面的画幅和填充选项。完整实现应把它变成渲染参数。

建议新增 `targetPlatform` 和 `renderProfile`：

| 目标 | 默认画幅 | 默认时长 | 渲染重点 |
| --- | --- | --- | --- |
| 抖音/快手/视频号 | 9:16 | 15-60 秒 | 强开头、字幕大、画面主体居中 |
| 小红书 | 9:16 或 1:1 | 20-90 秒 | 标题感、字幕清晰、封面强 |
| B 站 | 16:9 | 60-180 秒 | 信息完整、讲解节奏、标题清楚 |
| 通用导出 | 原比例或用户指定 | 用户配置 | 保持源画面，不强裁剪 |

注意：具体平台规格会变化，不应硬编码为不可改常量；应做成配置模板。

### 5.3 切片数量

当前固定 5 个。完整实现建议支持：

1. `auto`：按视频长度和质量阈值自动决定。
2. `fixed`：用户指定数量，例如 3、5、10。
3. `qualityFirst`：只输出达到质量阈值的片段，可能少于目标数量。
4. `coverageFirst`：尽量覆盖整条视频的不同主题，质量略低也补足数量。

默认建议：

```text
10 分钟以内：3-5 个
10-30 分钟：5-10 个
30 分钟以上：8-20 个
```

native 当前最多支持 20 个 clips，可作为一期上限。

### 5.4 时长控制

当前已有 `minDuration` 和 `maxDuration`。完整实现语义应改为：

1. `minDuration`：成片低于该时长通常不输出，除非内容极强。
2. `maxDuration`：超过该时长必须压缩边界或拆分。
3. `idealDuration`：平台和场景推荐时长，用于候选评分。
4. `preRollMs`：切点前补上下文，默认 800-2000ms。
5. `postRollMs`：切点后补自然收尾，默认 500-1500ms。

边界规则：

1. 如果 `minDuration > maxDuration`，UI 必须阻止提交。
2. 候选核心内容不足最小时长时，向前后扩展到句子/静音/场景边界。
3. 候选超过最大时长时，优先选择完整子主题，不直接硬截。

### 5.5 基础分段策略 `baseAlgorithm`

当前三个选项应落地为不同的“原子单元构建方式”。

| 选项 | 适用内容 | 实现逻辑 |
| --- | --- | --- |
| `nlp` NLP 语义智能断句 | 口播、讲解、会议、直播 | 以 ASR 句子、标点、speaker turn 和语义主题为主，生成 sentence/paragraph 单元 |
| `pause` 声音停顿识别 | 访谈、直播、长口播 | 用静音、语速变化、音量变化作为候选边界，避免从半句话开始 |
| `scene` 画面分镜切换识别 | 才艺、电影、vlog、动作画面 | 用镜头切换、画面变化、运动强度作为边界，优先保持视觉动作完整 |

推荐默认：

1. 口播类：`nlp`。
2. 对话类：`nlp + pause`。
3. 表演/电影/高动作：`scene + motion`。

### 5.6 高光提取引擎 `highlightEngine`

高光引擎决定候选窗口的评分重点。

| 选项 | 评分信号 | 适合场景 |
| --- | --- | --- |
| `emotion` 情绪波动 | 语气强度、音量峰值、笑声/惊讶/反问、情感词、弹幕式语气 | 直播、电影、才艺、娱乐内容 |
| `keyword` 关键词 | 商品名、价格、福利、方法、重点、结论、用户自定义词 | 带货、知识、会议、教程 |
| `motion` 动作幅度 | 镜头运动、主体运动、画面变化、表演高潮 | 才艺、运动、电影、vlog |

完整实现不应只把 `highlightEngine` 发给 LLM，而要在候选评分中体现。

### 5.7 AI 过滤项

当前过滤项需要明确是“规划过滤”还是“渲染处理”。

| 选项 | 目标语义 | 完整实现 |
| --- | --- | --- |
| 环境降噪增强 | 提升识别和成片听感 | 分析阶段可对 ASR 音频做降噪；渲染阶段可选音频降噪/响度标准化 |
| 咳嗽与杂音剔除 | 避开低质量片段 | 检测咳嗽、爆音、长停顿、杂音段；作为候选惩罚或边界修正 |
| 重复内容去重 | 避免输出多个重复短视频 | 对 transcript embedding、关键词和时间邻近进行去重，保留质量最高的一条 |

## 6. 核心切片算法

### 6.1 原子内容单元

系统先把整条视频拆成原子内容单元。原子单元不是最终切片，只是后续组合候选的基础。

原子单元类型：

1. `sentence`：一句完整转写文本。
2. `speakerTurn`：同一说话人的连续发言。
3. `topicBlock`：同一主题下多个句子组合。
4. `sceneShot`：一个镜头或视觉片段。
5. `audioPhrase`：由停顿分割出的音频短语。
6. `performanceBeat`：表演或动作完成节点。

每个单元至少包含：

```ts
interface SliceAtomicUnit {
  id: string;
  startMs: number;
  endMs: number;
  type: 'sentence' | 'speakerTurn' | 'topicBlock' | 'sceneShot' | 'audioPhrase' | 'performanceBeat';
  text?: string;
  speaker?: string;
  topic?: string;
  sceneId?: string;
  audioEnergy?: number;
  motionScore?: number;
  keywordScore?: number;
  emotionScore?: number;
  boundaryBeforeScore: number;
  boundaryAfterScore: number;
}
```

### 6.2 候选窗口生成

候选窗口由相邻原子单元组合而成，而不是随便取一个时间点。

生成规则：

1. 从每个高分原子单元作为核心开始。
2. 向前扩展到能提供上下文的句子、问题、商品名、人物名或场景开头。
3. 向后扩展到结论、回答结束、动作完成、CTA 或自然停顿。
4. 保证窗口时长在 `minDuration` 到 `maxDuration` 之间，或尽量接近 `idealDuration`。
5. 不允许候选从明显指代词开头，例如“这个”“然后”“所以”“刚才”“他”的前置对象缺失时必须向前扩展。
6. 不允许候选在半句话、半个 speaker turn、音乐强拍或动作中间结束。

候选窗口结构：

```ts
interface ShortVideoCandidate {
  id: string;
  coreStartMs: number;
  coreEndMs: number;
  startMs: number;
  endMs: number;
  title: string;
  topic: string;
  hookText?: string;
  summary: string;
  suggestedTags: string[];
  score: number;
  highlightScore: number;
  continuityScore: number;
  completenessScore: number;
  platformFitScore: number;
  duplicateGroupId?: string;
  risks: string[];
}
```

### 6.3 候选评分

建议总分结构：

```text
totalScore =
  0.30 * highlightScore
  + 0.25 * completenessScore
  + 0.20 * continuityScore
  + 0.15 * platformFitScore
  + 0.10 * diversityScore
  - penalties
```

各分项说明：

1. `highlightScore`：情绪、关键词、动作、反转、卖点、结论强度。
2. `completenessScore`：是否有开头、主体、收尾。
3. `continuityScore`：切点是否自然，是否缺主语/上下文，音视频是否突兀。
4. `platformFitScore`：时长、画幅、节奏、字幕密度是否适合目标平台。
5. `diversityScore`：避免多个片段都讲同一个点。
6. `penalties`：咳嗽、噪音、长静音、重复内容、画面黑屏、过短、过长、ASR 低置信。

### 6.4 LLM 参与方式

LLM 不应直接从完整视频自由生成切点。LLM 应接收结构化候选和转写摘要，然后完成：

1. 判断候选是否适合自媒体发布。
2. 判断开头是否需要补上下文。
3. 判断结尾是否完整。
4. 生成标题、看点、标签、发布理由。
5. 输出风险，例如“开头缺少商品名”“结尾没有结论”“这段重复”。

建议 LLM 输出 JSON：

```json
{
  "clips": [
    {
      "candidateId": "cand_001",
      "recommended": true,
      "startMs": 123000,
      "endMs": 178000,
      "title": "3个细节看懂这款产品为什么适合新手",
      "hook": "一开头就抛出产品痛点",
      "summary": "主播先指出常见问题，再展示功能和价格权益。",
      "tags": ["产品测评", "新手推荐"],
      "continuityFix": {
        "expandBeforeMs": 1200,
        "expandAfterMs": 800,
        "reason": "前一句说明了商品对象，结尾需要保留完整 CTA"
      },
      "qualityScore": 86,
      "risks": []
    }
  ]
}
```

最终切点仍必须经过规则层验证：

1. clip 不重叠，除非用户开启“允许重复素材”。
2. start/end 在源视频范围内。
3. start/end 对齐到语义/静音/场景边界。
4. duration 满足 min/max。
5. 如果 LLM 结果不合规，使用候选评分结果兜底。

## 7. 连贯性保障规则

连贯性是本需求的重点。建议引入 `continuityScore` 和 `continuityReport`。

### 7.1 开头连贯

短视频开头必须满足至少一条：

1. 直接出现核心对象：商品名、话题名、人名、问题。
2. 有明确钩子：反问、冲突、结论、悬念、痛点。
3. 是一段表演/动作的自然开始。
4. 是场景切换后的第一完整句或第一完整动作。

需要自动修正的坏开头：

1. 从“然后”“所以”“刚才”“这个”“它”“他”开始。
2. 从一句话中间开始。
3. 从回答中间开始但没有问题。
4. 从商品展示中间开始但没有商品上下文。
5. 从动作高潮中间开始导致观众不知道发生了什么。

修正策略：

1. 向前扩展到最近一句完整话。
2. 向前扩展到最近一个 speaker turn 起点。
3. 向前扩展到最近静音边界。
4. 向前扩展到最近场景切换点。
5. 若扩展后超过 `maxDuration`，降低该候选分或换候选。

### 7.2 结尾连贯

短视频结尾必须满足至少一条：

1. 完成一句完整话。
2. 完成一个回答。
3. 完成一个动作/镜头段落。
4. 完成一个价格/权益/CTA 表达。
5. 完成一个结论或反转。

需要自动修正的坏结尾：

1. 在“但是”“因为”“所以”“接下来”后结束。
2. 在 speaker turn 中间结束。
3. 在动作未完成或镜头快速移动中结束。
4. 在音乐强拍或表演高潮中硬切。
5. 刚出现问题但没有回答就结束。

修正策略：

1. 向后扩展到最近句末或停顿。
2. 向后扩展到回答结束。
3. 向后扩展到场景/动作完成点。
4. 添加 300-800ms 尾部缓冲。
5. 如果超过 `maxDuration`，优先裁掉开头冗余，而不是硬截结尾。

### 7.3 音频连贯

音频规则：

1. 切点优先落在低音量/静音边界。
2. 避免从字音中间开始或结束。
3. 输出可以加 80-150ms 音频淡入淡出，减少硬切感。
4. 咳嗽、爆音、明显噪声应作为候选惩罚。
5. 长静音超过阈值应裁掉，但保留 200-500ms 呼吸感。

当前 native FFmpeg 只是直接切片，还没有 fade 或响度处理。完整实现应增加可选 `audioPolish`。

### 7.4 画面连贯

画面规则：

1. 画面切点优先落在镜头切换、主体动作完成、低运动帧。
2. 避免在快速摇镜、转场中间、表演动作中间硬切。
3. 9:16 裁剪时要保证人脸、商品、主体位于安全区域。
4. 如果无法自动判断主体，默认使用 `contain` 保留完整画面；如果用户选择 `cover`，需要有预览和风险提示。

当前页面有 `aspectRatio` 和 `videoObjectFit` 预览，但 native 输出未使用这些参数。

### 7.5 语义连贯

语义规则：

1. 问答必须成对。
2. 商品卖点必须包含商品对象。
3. 教程必须包含步骤或结论。
4. 会议结论必须包含上下文和动作项。
5. 电影/剧情至少保留 setup 和 payoff。
6. 指代词开头必须向前补实体。
7. 重复口播只保留最佳一次。

## 8. 不同选项下的完整切片方式

### 8.1 商品直播

推荐配置：

```text
mode = 商品直播
baseAlgorithm = nlp
highlightEngine = keyword 或 emotion
repeatFilter = true
coughFilter = true
minDuration = 20
maxDuration = 60
targetAspectRatio = 9:16
subtitleMode = burned 或 srt
```

切片逻辑：

1. 识别商品名、价格、权益、赠品、库存、对比、用户痛点、CTA。
2. 候选必须包含商品对象，否则不能作为独立短视频。
3. 如果片段只出现“这个真的很好”，但前面才说商品名，需要向前扩展。
4. 同一商品同一卖点重复讲多遍时，保留音画清晰、情绪最好、表达最完整的一次。
5. 推荐输出类型：
   - 痛点 + 解决方案；
   - 卖点讲解；
   - 价格/福利/限时权益；
   - 对比竞品；
   - 用户疑问回答。

### 8.2 单人讲解

推荐配置：

```text
mode = 单人讲解
baseAlgorithm = nlp
highlightEngine = keyword
repeatFilter = true
minDuration = 30
maxDuration = 120
targetAspectRatio = 9:16 或 16:9
```

切片逻辑：

1. 按主题段落构建候选。
2. 每个短视频必须围绕一个观点、一个方法或一个结论。
3. 开头优先选择“问题/结论/反常识”句子。
4. 结尾必须包含总结、结果或下一步。
5. 如果一段内容需要前文铺垫，向前补 1-2 句，不直接从核心句开始。

### 8.3 双人连线直播

推荐配置：

```text
mode = 双人连线直播
baseAlgorithm = nlp + pause
highlightEngine = emotion
minDuration = 30
maxDuration = 90
```

切片逻辑：

1. 先做 speaker turn 分割。
2. 候选必须包含完整问答或完整观点交锋。
3. 如果只截回答，必须向前补问题。
4. 如果冲突在回答后才有反应，向后补反应。
5. 避免多人抢话、音频重叠严重的片段，除非情绪价值很高。

### 8.4 多人连线直播

推荐配置：

```text
mode = 多人连线直播
baseAlgorithm = nlp + pause
highlightEngine = emotion 或 keyword
minDuration = 45
maxDuration = 120
```

切片逻辑：

1. 先聚类同一话题下的连续讨论。
2. 优先输出主线清楚、speaker 切换不混乱的片段。
3. 不建议切很短，否则观众很难理解多人关系。
4. 如果出现多个话题交叉，应选择最完整的主话题窗口。

### 8.5 在线会议

推荐配置：

```text
mode = 在线会议
baseAlgorithm = nlp
highlightEngine = keyword
minDuration = 45
maxDuration = 180
targetAspectRatio = 16:9
```

切片逻辑：

1. 识别决策、结论、行动项、争议点。
2. 不追求情绪高点，优先完整表达。
3. 候选必须包含背景和结论。
4. 如果只是某人说“这个我们下周做”，需要向前补“这个”指代的事项。
5. 输出标题应偏“结论型”，例如“关于上线节奏的三个关键决策”。

### 8.6 才艺表演

推荐配置：

```text
mode = 才艺表演
baseAlgorithm = scene
highlightEngine = motion 或 emotion
minDuration = 30
maxDuration = 120
targetAspectRatio = 9:16
```

切片逻辑：

1. 以镜头、动作、音乐段落作为核心边界。
2. 避免在动作中间或音乐强拍中间切。
3. 选择高潮动作前一点开始，保留铺垫。
4. 结尾保留动作完成后的短暂停顿或观众反应。
5. 转写不是主信号，音频能量和画面运动更重要。

### 8.7 电影/剧情类

推荐配置：

```text
mode = 电影
baseAlgorithm = scene
highlightEngine = emotion
minDuration = 45
maxDuration = 180
targetAspectRatio = 16:9 或 9:16
```

切片逻辑：

1. 按场景和剧情节点识别 setup、conflict、payoff。
2. 避免只切反转结果而没有前因。
3. 避免在台词中间、镜头运动中间切。
4. 如果目标是二创解说，应后续进入“混剪成片”模式，而不是普通连续切片。

### 8.8 通用模式

推荐配置：

```text
mode = 通用
baseAlgorithm = nlp
highlightEngine = emotion
minDuration = 15
maxDuration = 90
targetAspectRatio = auto
```

切片逻辑：

1. 综合转写、停顿、情绪、关键词和视觉变化。
2. 先保证片段完整，再追求高光。
3. 输出数量按质量阈值决定，不够时不强行补低质量片段。

## 9. 成片处理逻辑

切片不是终点。用于自媒体发布时，还需要成片处理。

### 9.1 画幅处理

支持三种模式：

1. `original`：保持原画幅。
2. `contain`：适应目标画幅，可能留黑边或背景模糊。
3. `cover`：填充目标画幅，可能裁剪。

推荐：

1. 横屏源视频转竖屏时，默认不要直接中心裁剪；应检测人脸/主体/商品位置。
2. 检测不到主体时默认 `contain` 或模糊背景。
3. 用户在页面中选择的 `aspectRatio` 和 `videoObjectFit` 必须传到 native render。

### 9.2 字幕处理

字幕建议分层：

1. `none`：不输出字幕。
2. `srt`：输出外挂字幕文件。
3. `burned`：烧录字幕到视频。
4. `bilingual`：双语字幕，依赖翻译能力。

当前实现只有 SRT。若目标是自媒体发布，建议优先做 burned subtitle，因为多数平台上传短视频时，烧录字幕的传播效果更稳定。

### 9.3 标题和封面

每个短视频应输出：

1. 建议标题。
2. 一句话看点。
3. 建议标签。
4. 推荐封面帧时间点。
5. 缩略图文件。

缩略图不应只取中点帧。建议选择：

1. 人脸清晰；
2. 商品清楚；
3. 动作高潮；
4. 字幕/标题不遮挡主体；
5. 非黑屏、非模糊、非转场中间。

### 9.4 音频处理

建议支持：

1. 音量标准化。
2. 可选降噪。
3. 开头/结尾淡入淡出。
4. 裁掉超长静音。

### 9.5 结果元数据

每个切片结果除视频 URL 外，还应包含：

```ts
interface ShortVideoSliceResult {
  id: string;
  name: string;
  title: string;
  summary: string;
  tags: string[];
  sourceStartMs: number;
  sourceEndMs: number;
  duration: number;
  size: number;
  resolution: string;
  aspectRatio: string;
  continuityScore: number;
  qualityScore: number;
  reason: string;
  risks: string[];
  thumbnailUrl: string;
  url: string;
  subtitleUrl?: string;
}
```

## 10. 完整任务流程

建议服务层重构为明确阶段：

```text
processVideoSlice(params)
  -> validateSliceRequest(params)
  -> createTask()
  -> resolveSource()
  -> importMediaFile()
  -> probeMedia()
  -> transcribeMedia()
  -> analyzeAudioVideoSignals()
  -> buildAtomicUnits()
  -> buildCandidateWindows()
  -> scoreCandidates()
  -> requestLlmSelection()
  -> normalizeAndRepairClipPlan()
  -> renderShortVideoSlices()
  -> runOutputQualityChecks()
  -> persistAssetsAndTask()
```

阶段说明：

| 阶段 | 责任 | 当前是否具备 |
| --- | --- | --- |
| source validation | 校验本地文件/URL/资产来源 | 部分具备 |
| import media | 导入本地文件并写 media_asset | 已具备 |
| probe media | 读取时长、分辨率、fps、音轨 | native 内部部分具备，前端未建模 |
| transcription | 生成转写时间轴 | 已具备可选 |
| signal analysis | 静音、情绪、关键词、场景、运动 | 不完整 |
| atomic units | 构建句子/话题/镜头单元 | 不具备 |
| candidate windows | 生成可发布候选短视频 | 不具备 |
| scoring | 高光、完整性、连贯性评分 | 不具备 |
| LLM selection | 语义筛选、标题、理由 | 部分具备 |
| normalize/repair | 切点修正、非重叠、边界修复 | 部分具备 |
| render | FFmpeg 输出视频、缩略图、字幕 | 部分具备 |
| QC | 成片质量检查 | 不具备 |
| persist | 任务、资产、消息和结果 | 已具备基础 |

## 11. 需要调整的数据结构

### 11.1 `VideoSliceParams`

建议扩展：

```ts
interface VideoSliceParams {
  mode: SliceMode;
  fileId?: string;
  file?: File | null;
  url?: string;

  targetPlatform?: 'douyin' | 'kuaishou' | 'shipinhao' | 'xiaohongshu' | 'bilibili' | 'generic';
  targetAspectRatio?: 'auto' | '16:9' | '9:16' | '1:1' | '4:3';
  videoObjectFit?: 'contain' | 'cover';
  sliceCountMode?: 'auto' | 'fixed' | 'qualityFirst' | 'coverageFirst';
  targetSliceCount?: number;
  idealDuration?: number;
  continuityLevel?: 'standard' | 'strict';
  customKeywords?: string[];

  llmModel: SliceLLM;
  minDuration: number;
  maxDuration: number;
  baseAlgorithm: SliceAlgorithm;
  highlightEngine: SliceHighlightEngine;
  enableNoiseReduction: boolean;
  enableCoughFilter: boolean;
  enableRepeatFilter: boolean;
  enableSubtitles?: boolean;
  subtitleMode?: 'srt' | 'burned';
  subtitleStyleId?: string;
}
```

### 11.2 Native render request

当前 native `AutoCutVideoSliceClipRequest` 只有 `startMs/durationMs/label`。完整实现建议扩展 clip metadata：

```ts
interface AutoCutVideoSliceClipRequest {
  startMs: number;
  durationMs: number;
  label: string;
  title?: string;
  summary?: string;
  qualityScore?: number;
  continuityScore?: number;
}
```

如果要做画幅和字幕烧录，需要扩展 `AutoCutVideoSliceRequest`：

```ts
interface AutoCutVideoSliceRequest {
  assetUuid: string;
  clips: AutoCutVideoSliceClipRequest[];
  outputFormat: 'mp4';
  outputRootDir?: string;
  renderProfile?: {
    aspectRatio: 'auto' | '16:9' | '9:16' | '1:1' | '4:3';
    objectFit: 'contain' | 'cover';
    audioFade: boolean;
    loudnessNormalize: boolean;
  };
  subtitleFormat?: 'srt';
  subtitleBurnIn?: boolean;
  subtitleStyleId?: string;
  subtitleSegments?: AutoCutSpeechTranscriptionSegment[];
}
```

## 12. 当前代码需要补齐的实现点

按优先级排序：

1. 修正“云端解析”与实际本地处理不一致的文案或禁用 URL 提交流程。
2. 让页面 LLM 模型选择真正传入 LLM 调用，或移除该页面选项统一走设置中心。
3. 增加 min/max 校验，禁止 `minDuration > maxDuration`。
4. 增加 `targetPlatform`、`targetAspectRatio`、`sliceCountMode`、`targetSliceCount`。
5. 把当前固定 5 个改成用户配置或自动数量，但不超过 native 20 个上限。
6. 实现 transcript atomic unit 构建：句子、speaker turn、topic block。
7. 实现候选窗口生成，不再只用转写 segment 或 deterministic spacing。
8. 实现 continuity scoring 和切点 repair。
9. LLM prompt 改为基于候选窗口选择，并输出标题、理由、风险和建议边界修正。
10. 原生切片支持中文 label 安全保存，避免所有中文标题被清洗成 `Highlight N`。
11. 将画幅和 `objectFit` 从预览传到 native render。
12. 输出真实分辨率，不再固定 `1080P`。
13. 缩略图改为候选最佳帧，而不是中点帧。
14. 任务详情展示标题、理由、质量分、连贯性分、字幕下载。
15. 如启用字幕发布能力，支持 burned subtitle 或至少在结果页清晰下载 SRT。
16. 增加成片 QC：视频可播放、非空、时长合规、无 0 字节、字幕时间不越界。

## 13. 验收标准

### 13.1 基础功能

1. 用户选择一条 trusted 本地视频后，可以生成多个 MP4 短视频。
2. 每个短视频有缩略图、标题、时长、大小、来源时间段。
3. 任务详情可预览每个短视频并下载。
4. 失败时能展示明确原因。

### 13.2 连贯性

抽样检查生成结果：

1. 不从半句话开始。
2. 不在半句话结束。
3. 不缺少核心对象或问题上下文。
4. 问答类片段包含问题和回答。
5. 商品类片段包含商品对象和至少一个卖点/权益。
6. 表演类片段不在明显动作中间硬切。
7. 结尾有自然停顿或完成节点。

建议自动质检：

1. `continuityScore >= 70` 才默认输出。
2. `qualityScore >= 65` 才默认输出。
3. 低于阈值但为了补足数量输出时，结果页标注风险。

### 13.3 自媒体发布适配

1. 9:16 输出时主体不应明显被裁掉。
2. 字幕不应遮挡核心主体。
3. 缩略图不能是黑屏、过曝、模糊或转场帧。
4. 标题不能为空，且能描述片段看点。
5. 同一任务输出片段主题尽量不重复。

## 14. 推荐一期实现切片逻辑

如果只做一期，建议落地这条主线：

```text
trusted local video
  -> import
  -> transcribe
  -> build sentence/speaker-turn units
  -> generate contiguous candidate windows
  -> score highlight/completeness/continuity
  -> LLM select top candidates and generate title/reason
  -> deterministic repair start/end
  -> native slice MP4 + thumbnail + SRT
  -> task detail preview/download
```

一期暂不做：

1. URL 云端拉取。
2. 多段混剪。
3. 自动 B-roll。
4. 双语翻译字幕。
5. 高级主体跟踪裁剪。

但一期必须避免：

1. 用固定间隔强行补齐低质量片段。
2. LLM 直接决定最终毫秒切点。
3. 普通浏览器 File 或 URL 提交后必失败。
4. 把 prompt 字段当作真实算法能力。

## 15. 待确认问题

1. 一期是否只支持本地 trusted 视频，不支持 URL 云端切片？
2. 默认输出数量是否仍是 5 个，还是改为用户可选/质量优先？
3. 自媒体目标平台是否需要一期进入 UI，还是先用通用 9:16/16:9 画幅配置？
4. 字幕一期是外挂 SRT，还是必须烧录到视频？
5. 是否允许输出少于目标数量，只保证质量？
6. 是否需要保留所有低质量候选供用户手动选择，还是只展示通过质检的成片？
7. 商品直播是否需要用户输入商品名/关键词，帮助 keyword engine 精准识别？
8. 是否要求生成标题、标签和推荐封面，还是只输出视频文件？

