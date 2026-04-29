# 03 Provider Contract And AI Standards

日期：2026-04-26

## 目标

本标准定义 AI、STT、字幕、媒体、存储、工具、配置等可替换能力的统一 provider/port/adapter 体系。所有模型能力采用 OpenAI-compatible 接口标准，不使用 Ollama，不依赖 `spring-ai-plus-ai-api` 或 `spring-ai-plus-app-api`。

## Port/Adapter 分层

```text
UseCase
  -> Port trait
  -> ProviderRegistry
  -> Adapter
  -> External tool/model/http endpoint/storage
```

规则：

- use case 只依赖 port。
- adapter 负责第三方 DTO 到领域模型的映射。
- provider 私有字段不能进入 domain 或 `plan.json`。
- 所有 provider 必须有 capability、health、configuration schema、diagnostics、fake adapter、conformance test。

## ProviderKind

```rust
pub enum ProviderKind {
    LargeLanguageModel,
    SpeechToText,
    TextNormalization,
    KeywordHighlight,
    Subtitle,
    MediaProbe,
    MediaRender,
    AudioBoundary,
    SpeechActivity,
    SceneDetection,
    SubjectTracking,
    VideoStabilization,
    AudioEnhancement,
    CoverRender,
    ToolLocator,
    CommandRunner,
    RuntimeConfig,
    SecretStore,
    Telemetry,
    TaskStorage,
    ArtifactStorage,
    ModelAssetRepository,
}
```

## OpenAI-compatible LLM

用途：

- 问答识别
- 废话/广告识别
- 重复语义识别
- 高亮词生成
- 封面文案
- 长访谈片段评分

标准接口：

```http
POST {baseUrl}/v1/chat/completions
```

结构化输出策略：

- 优先使用 JSON Schema structured output。
- 不支持 JSON Schema 时降级到 JSON object mode。
- 降级结果必须由 Rust host 做 JSON Schema 校验。
- schema 校验失败最多重试一次。
- 仍失败则返回 `OPENAI_COMPATIBLE_STRUCTURED_OUTPUT_INVALID`。

禁止：

- 返回 markdown JSON 当业务结果。
- 返回自然语言解释当业务结果。
- 模型直接生成 FFmpeg 命令。
- 模型直接修改任务状态或写 artifact。

## OpenAI-compatible STT

标准接口：

```http
POST {baseUrl}/v1/audio/transcriptions
```

标准输出：

```ts
export interface Transcript {
  language: string;
  durationSeconds: number;
  segments: TranscriptSegment[];
  speakers?: SpeakerTurn[];
  source: {
    providerId: string;
    model?: string;
    granularity: Array<'segment' | 'word'>;
  };
}
```

规则：

- `SpeechToTextPort` 不知道 provider 是 OpenAI-compatible、local whisper 还是其他实现。
- `LocalWhisperSpeechToTextAdapter` 只能作为转写 fallback，不承担语义分析。
- 词级时间戳和 speaker diarization 是 capability，不是默认承诺。

### STT Provider Bridge Profiles

当前实现采用 Host 内部 `speech-to-text-bridge.adapter.v1` 适配层。业务、字幕、切分、诊断和 UI 只消费标准 `TranscriptDocument`，供应商私有请求头、请求体和响应 DTO 不允许越过 adapter 边界。

标准 profile：

| profile | 供应商接口 | 认证 | 标准化规则 |
| --- | --- | --- | --- |
| `openai-audio-transcriptions` | `{baseUrl}/v1/audio/transcriptions` | Bearer API key | multipart `file` + `model` + `response_format=verbose_json`，原生 verbose JSON 作为规范响应。 |
| `volcengine-bigasr-flash` | `{baseUrl}/api/v3/auc/bigmodel/recognize/flash` | `X-Api-Key` + `X-Api-Resource-Id` | Host 将 WAV 转 base64 JSON 请求，把 `result.text` 和 `result.utterances[].start_time/end_time/text/confidence` 映射为 OpenAI verbose JSON。 |
| `aliyun-qwen-asr` | `{baseUrl}/compatible-mode/v1/chat/completions` | Bearer API key | Host 使用 OpenAI-compatible chat payload 的 `input_audio` data URL，请求 JSON object 输出，并映射 `choices[0].message.content` 为标准 verbose JSON。 |

`speechToText.providerProfile` 必须是上述枚举之一。`volcengine-bigasr-flash` 必须配置非空 `speechToText.resourceId`，默认值为 `volc.bigasr.auc`。`resourceId` 属于非 secret 元数据，可以进入 redacted conformance 详情；API key、Authorization、`X-Api-Key` 和 secret ref 不得进入日志、artifact、diagnostics 或 conformance report。

Runtime output must be persisted as `TranscriptDocument`:

- schema id: `video-cut.transcript.schema.v1`
- artifact path: `workspace/projects/default/tasks/{taskId}/analysis/transcript.json`
- artifact id: `{taskId}-transcript`
- status: `ok | failed | provider-unavailable | audio-unavailable`
- failed/provider-unavailable/audio-unavailable documents must include warnings and must not fabricate text or segments.

`SpeechToTextPort` returns the domain transcript document. OpenAI-compatible response DTOs are adapter-internal and must not leak into `VideoSplitPlan`, subtitles, diagnostics, or UI state.

## OpenAI-compatible Semantic Analysis

Semantic analysis uses the same LLM provider contract as other structured AI stages:

```http
POST {baseUrl}/v1/chat/completions
```

Runtime output must be persisted as `SemanticAnalysisDocument`:

- schema id: `video-cut.semantic-analysis.schema.v1`
- artifact path: `workspace/projects/default/tasks/{taskId}/analysis/semantic-analysis.json`
- artifact id: `{taskId}-semantic-analysis`
- status: `ok | failed | provider-unavailable | transcript-unavailable`
- failed/provider-unavailable/transcript-unavailable documents must include warnings and must not fabricate summaries, topics, QA candidates, or cut facts.

`SemanticAnalysisPort` consumes `TranscriptDocument` and returns the domain semantic analysis document. It must use structured output validation and must not directly mutate `VideoSplitPlan`.

## Runtime Secret Store And HTTP Executor

Provider credentials must flow through `SecretStorePort`, not through persisted settings or diagnostics.

Rules:

- `PUT /api/video-cut/v1/settings` may accept plaintext `ai.apiKey` and `speechToText.apiKey` only as write-only input.
- Host must extract plaintext keys into the runtime secret store before validation and set the matching `apiKeyConfigured=true` marker.
- `runtime/settings.json`, `GET /settings`, doctor reports, diagnostics bundles, provider conformance reports, events, render logs, and analysis artifacts must not contain plaintext keys or an `apiKey` field.
- Provider requests resolve credentials from secret refs such as `settings://ai/api-key` and `settings://speech-to-text/api-key`.
- Missing runtime credentials must produce `provider-unavailable` artifacts with warnings, not fake successful model output.

OpenAI-compatible HTTP execution is an adapter concern:

- STT adapter sends multipart requests to `{baseUrl}/v1/audio/transcriptions` with `file`, `model`, `response_format=verbose_json`, optional `language`, and timestamp granularity.
- Semantic adapter sends JSON requests to `{baseUrl}/v1/chat/completions` with structured output response format.
- Adapter errors may include status codes and safe operational messages only; they must not include Authorization headers, bearer tokens, API keys, or raw provider payloads that could contain secrets.
- Provider DTOs are converted into `TranscriptDocument` and `SemanticAnalysisDocument` before leaving the adapter.

## Prompt Registry And Schema Registry

本章节也称 `Prompt And Schema Registry`，正式实现命名优先使用 `PromptRegistry`、`SchemaRegistry` 和 `ModelProfileRegistry` 三个独立边界。

目录：

```text
host/resources/
  prompts/
  schemas/
  model-profiles/
```

治理规则：

- prompt 必须声明 `promptId`、`version`、`purpose`、`inputSchemaId`、`outputSchemaId`。
- schema 必须有 `$id`、`version`、`additionalProperties: false`。
- LLM 输出 schema 必须比内部 domain schema 更窄。
- 模型选择来自 `ModelProfileRegistry`，不写死到 use case。
- prompt 变更必须有 snapshot/contract test。

## Provider Registry

```text
ProviderRegistry
  -> ProviderDescriptor[]
  -> capability discovery
  -> health check
  -> configuration schema
  -> adapter factory
```

`ProviderDescriptor`：

```ts
export interface ProviderDescriptor {
  providerId: string;
  providerKind: ProviderKind;
  adapterVersion: string;
  displayName: string;
  capabilitySchemaId: string;
  configurationSchemaId: string;
  healthStatus: 'ok' | 'degraded' | 'unavailable';
  license: string;
  supportedDeploymentModes: string[];
  runtimeRequirements: string[];
}
```

## Current Code Standard

Rust host 当前 provider 标准入口为 `host/src/providers.rs`。该模块定义：

- `ProviderKind`
- `ProviderDescriptor`
- `ProviderHealthStatus`
- `OpenAiCompatibleProviderConfig`
- `LlmProviderPort`
- `SpeechToTextPort`
- `SubtitlePort`
- `SecretStorePort`

`/api/video-cut/v1/capabilities` 必须公开 provider contract policy：

```json
{
  "providerCapabilityVersion": "video-cut.provider-capability.schema.v1",
  "configurationSchemaId": "video-cut.openai-compatible-provider-config.schema.v1",
  "openAiCompatible": {
    "chatCompletionsEndpoint": "/v1/chat/completions",
    "audioTranscriptionsEndpoint": "/v1/audio/transcriptions",
    "structuredOutputModes": ["json-schema", "json-object-fallback"],
    "ollamaAllowed": false
  },
  "speechToTextProviderProfiles": [
    "openai-audio-transcriptions",
    "volcengine-bigasr-flash",
    "aliyun-qwen-asr"
  ],
  "requiredPorts": [
    "LlmProviderPort",
    "SpeechToTextPort",
    "SubtitlePort",
    "SecretStorePort"
  ]
}
```

实现约束：

- API key 只能通过 Host 内部 `SecretStorePort` 和稳定 secret ref 解析；公开 API、conformance report、task manifest、artifact manifest、plan、events、logs 或 localStorage 都不得暴露 secret ref 字段名或 secret ref 值。
- OpenAI-compatible base URL 只作为 endpoint base，adapter 统一拼接 `/v1/chat/completions` 和 `/v1/audio/transcriptions`。
- Ollama endpoint、`localhost:11434`、`127.0.0.1:11434` 必须 fail fast。
- 缺少 LLM model、STT model、provider credential、超时和重试越界必须在配置校验阶段返回标准 validation error；公开 error field 使用 `credential`，不得使用 `apiKeySecretRef`、`credentialSecretRef` 或其他 secret-ref 字段名。
- Settings Center 只做前端即时校验；Rust host `PUT /settings` 是最终防线，必须在无效配置时返回 `valid=false` 并保持旧配置不变。

## Secret And Redaction

- API key 来自 `SecretStorePort`。
- desktop-local 使用 OS secure store。
- server/container 使用 env/secret file。
- Kubernetes 使用 Secret。
- 不把 API key 写入 task、artifact、prompt、log、localStorage。
- provider 日志只记录 endpoint host、model、耗时、usage、traceId。

## Provider Conformance

每个 provider 必须通过：

- capability schema test
- health check test
- happy path fake test
- unsupported capability test
- timeout/cancel test
- error mapping test
- redaction test
- deterministic output snapshot test

## Runtime Provider Conformance API

当前落地的 provider conformance 入口为：

```http
POST /api/video-cut/v1/providers/openai-compatible/conformance
```

请求：

```json
{
  "target": "ai"
}
```

`target` 支持 `ai`、`speechToText`、`all`。Host 必须只根据已保存的运行时设置生成 dry-run conformance report，不允许前端直接访问 OpenAI-compatible endpoint，也不允许在报告中输出 `apiKey`、token、Authorization header 或 secret ref。报告只允许输出 `credentialStatus: configured | not-configured`。

报告版本：

```json
{
  "reportVersion": "video-cut.provider-conformance.v1",
  "providerId": "runtime-openai-compatible",
  "status": "ok",
  "checks": []
}
```

标准检查项至少包含：

- `llm.endpoint.chatCompletions`：拼接 `{baseUrl}/v1/chat/completions`。
- `llm.structuredOutput`：声明 JSON Schema 或 `json_object` fallback 请求格式。
- `stt.endpoint.audioTranscriptions`：拼接 `{baseUrl}/v1/audio/transcriptions`，并声明 multipart transcription 请求。
- `stt.provider.bridge`：声明当前 `speechToText.providerProfile`、canonical request/response、vendor endpoint、model、language、timestamp granularity、resourceId 和 credentialStatus。
- `provider.config.validation`：配置无效时返回标准 validation errors。

该 API 是设置中心 “Test structured output” 和 “Test transcription” 的唯一入口；UI 只能调用 `VideoCutHostClient.runProviderConformance()`。
