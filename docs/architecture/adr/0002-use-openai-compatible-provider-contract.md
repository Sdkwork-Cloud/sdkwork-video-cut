# ADR-0002: Use OpenAI-Compatible Provider Contract

日期：2026-04-26
状态：accepted

## Context

视频剪辑需要 LLM 结构化分析和 STT 转写。用户明确要求不要使用 Ollama，要采用 OpenAI-compatible 接口标准，并且项目不能依赖 `spring-ai-plus-ai-api` 或 `spring-ai-plus-app-api`。

## Decision

AI provider 统一采用 OpenAI-compatible HTTP contract，并封装到 `LargeLanguageModelPort` 和 `SpeechToTextPort`。业务层只消费标准领域模型，不接触 provider 私有 DTO。

## Options

| Option | Pros | Cons |
| --- | --- | --- |
| OpenAI-compatible contract | 厂商可替换、协议清晰、易做 mock 和 conformance | 不同兼容厂商能力差异需要 capability 管理 |
| Ollama provider | 本地模型方便 | 不符合用户要求，API 专有化，容易泄漏到业务层 |
| spring-ai-plus-ai-api | 现有项目生态 | 与独立运行目标冲突 |
| provider SDK 直连 | 某厂商能力完整 | 绑定强，替换成本高 |

## Consequences

- LLM 使用 `/v1/chat/completions`。
- STT 使用 `/v1/audio/transcriptions`。
- 结构化输出必须走 JSON Schema 或 JSON object fallback + 本地校验。
- Provider capability 必须声明 JSON Schema、audio transcription、timestamp granularity 等能力。

## Guardrails

- 不增加 `OllamaProvider`。
- 不调用 llama.cpp 专有 API 作为产品契约。
- 不把 API key 写入 task、artifact、日志或 localStorage。
- 不把 provider 原始响应作为业务结果。

## Review Trigger

- OpenAI-compatible 生态出现不可兼容的重大协议变化。
- 需要引入 Responses-compatible adapter，但必须仍通过 port 隔离。

