import { generateText, type ModelMessage } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { AutoCutLlmRuntimeConfig } from '@sdkwork/autocut-types';
import {
  configureAutoCutApprovedAiSdkBridge,
  type AutoCutOpenAiCompatibleChatCompletionRequest,
  type AutoCutOpenAiCompatibleChatCompletionResult,
} from './llm.service';
import { getAutoCutNativeHostClient } from './native-host-client.service';

export interface AutoCutVercelAiSdkProviderConfig {
  name: string;
  baseURL: string;
  apiKey: string;
  fetch: typeof globalThis.fetch;
}

export interface AutoCutVercelAiSdkBridgeInput {
  provider: AutoCutVercelAiSdkProviderConfig;
  request: AutoCutOpenAiCompatibleChatCompletionRequest & {
    model: string;
    temperature: number;
    maxTokens: number;
  };
  runtime: AutoCutLlmRuntimeConfig;
}

export type AutoCutVercelAiSdkTextGenerator = (
  input: AutoCutVercelAiSdkBridgeInput,
) => Promise<AutoCutOpenAiCompatibleChatCompletionResult>;

export function configureAutoCutVercelAiSdkBridge(
  generateCompletion: AutoCutVercelAiSdkTextGenerator = generateAutoCutVercelAiSdkText,
) {
  configureAutoCutApprovedAiSdkBridge({
    async createChatCompletion(request, runtime) {
      return generateCompletion({
        provider: toAutoCutVercelAiSdkProviderConfig(runtime),
        request,
        runtime,
      });
    },
  });
}

async function generateAutoCutVercelAiSdkText({
  provider: providerConfig,
  request,
  runtime,
}: AutoCutVercelAiSdkBridgeInput): Promise<AutoCutOpenAiCompatibleChatCompletionResult> {
  const provider = createOpenAICompatible(providerConfig);
  const result = await generateText({
    model: provider.chatModel(request.model),
    messages: toAutoCutVercelAiSdkMessages(request.messages),
    temperature: request.temperature,
    maxOutputTokens: request.maxTokens,
  });

  return {
    id: typeof result.response?.id === 'string' ? result.response.id : 'vercel-ai-sdk-text-result',
    model: request.model,
    content: result.text,
    runtime,
  };
}

function toAutoCutVercelAiSdkProviderConfig(runtime: AutoCutLlmRuntimeConfig): AutoCutVercelAiSdkProviderConfig {
  if (!runtime.sessionApiKey) {
    throw new Error('AutoCut LLM API key is required for the Vercel AI SDK bridge.');
  }

  return {
    name: runtime.modelVendor,
    baseURL: runtime.baseUrl,
    apiKey: runtime.sessionApiKey,
    fetch: fetchAutoCutLlmViaNativeHost,
  };
}

async function fetchAutoCutLlmViaNativeHost(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const bodyText = await request.text();
  const nativeResponse = await getAutoCutNativeHostClient().sendLlmHttpRequest({
    url: request.url,
    method: request.method,
    headers: headersToRecord(request.headers),
    ...(bodyText ? { bodyText } : {}),
  });

  return new Response(nativeResponse.bodyText, {
    status: nativeResponse.status,
    statusText: nativeResponse.statusText,
    headers: nativeResponse.headers,
  });
}

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

function toAutoCutVercelAiSdkMessages(messages: AutoCutOpenAiCompatibleChatCompletionRequest['messages']): ModelMessage[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      throw new Error('AutoCut Vercel AI SDK bridge does not support tool messages yet.');
    }

    return {
      role: message.role,
      content: message.content,
    };
  });
}
