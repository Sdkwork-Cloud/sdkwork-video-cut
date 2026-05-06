import {
  AUTOCUT_MODEL_VENDOR_PRESETS,
  type AutoCutLlmConnectionTestResult,
  type AutoCutLlmRuntimeConfig,
  type ModelVendor,
} from '@sdkwork/autocut-types';
import { resolveAutoCutLlmRuntimeConfig } from './settings.service';

export interface AutoCutOpenAiCompatibleMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}

export interface AutoCutOpenAiCompatibleChatCompletionRequest {
  messages: AutoCutOpenAiCompatibleMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AutoCutOpenAiCompatibleChatCompletionResult {
  id: string;
  model: string;
  content: string;
  runtime: AutoCutLlmRuntimeConfig;
}

export interface AutoCutApprovedAiSdkBridge {
  createChatCompletion(
    request: AutoCutOpenAiCompatibleChatCompletionRequest & {
      model: string;
      temperature: number;
      maxTokens: number;
    },
    runtime: AutoCutLlmRuntimeConfig,
  ): Promise<AutoCutOpenAiCompatibleChatCompletionResult>;
}

let approvedAiSdkBridge: AutoCutApprovedAiSdkBridge | null = null;

export function configureAutoCutApprovedAiSdkBridge(bridge: AutoCutApprovedAiSdkBridge | null) {
  approvedAiSdkBridge = bridge;
}

export async function createAutoCutOpenAiCompatibleChatCompletion(
  request: AutoCutOpenAiCompatibleChatCompletionRequest,
): Promise<AutoCutOpenAiCompatibleChatCompletionResult> {
  const runtime = await resolveAutoCutLlmRuntimeConfig();
  validateAutoCutOpenAiCompatibleChatCompletionRequest(request, runtime);
  const model = resolveAutoCutChatCompletionModel(request, runtime);

  if (!approvedAiSdkBridge) {
    throw new Error(
      'AutoCut LLM calls require an approved AI SDK bridge; raw OpenAI-compatible HTTP fallback is disabled.',
    );
  }

  return approvedAiSdkBridge.createChatCompletion(
    {
      ...request,
      model,
      temperature: request.temperature ?? runtime.temperature,
      maxTokens: request.maxTokens ?? runtime.maxTokens,
    },
    runtime,
  );
}

function resolveAutoCutChatCompletionModel(
  request: AutoCutOpenAiCompatibleChatCompletionRequest,
  runtime: AutoCutLlmRuntimeConfig,
) {
  const requestedModel = request.model?.trim();
  if (!requestedModel) {
    return runtime.model;
  }

  const requestedModelVendor = getAutoCutModelVendorForModel(requestedModel);
  if (requestedModelVendor !== runtime.modelVendor) {
    if (runtime.modelVendor === 'custom' && requestedModelVendor === null) {
      return requestedModel;
    }

    throw new Error(
      `AutoCut LLM model ${requestedModel} is not available for the configured ModelVendor ${runtime.modelVendor}.`,
    );
  }

  return requestedModel;
}

export function getAutoCutModelVendorForModel(model: string): ModelVendor | null {
  const normalizedModel = model.trim();
  if (!normalizedModel) {
    return null;
  }

  for (const preset of Object.values(AUTOCUT_MODEL_VENDOR_PRESETS)) {
    if (preset.models.some((candidate) => candidate.id === normalizedModel)) {
      return preset.vendor;
    }
  }

  return null;
}

export async function testAutoCutLlmConnection(): Promise<AutoCutLlmConnectionTestResult> {
  const result = await createAutoCutOpenAiCompatibleChatCompletion({
    messages: [
      {
        role: 'user',
        content: 'Reply with exactly: pong',
      },
    ],
    temperature: 0,
    maxTokens: 16,
  });

  return {
    success: true,
    modelVendor: result.runtime.modelVendor,
    baseUrl: result.runtime.baseUrl,
    model: result.model,
    content: result.content.trim(),
  };
}

function validateAutoCutOpenAiCompatibleChatCompletionRequest(
  request: AutoCutOpenAiCompatibleChatCompletionRequest,
  runtime: AutoCutLlmRuntimeConfig,
) {
  if (!runtime.baseUrl) {
    throw new Error('AutoCut LLM base URL is required before creating chat completions.');
  }

  if (!runtime.model) {
    throw new Error('AutoCut LLM model is required before creating chat completions.');
  }

  if (!runtime.apiKeyConfigured) {
    throw new Error('AutoCut LLM API key is required before creating chat completions.');
  }

  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    throw new Error('AutoCut LLM chat completion requires at least one message.');
  }

  for (const message of request.messages) {
    if (!message.content.trim()) {
      throw new Error('AutoCut LLM chat completion messages must not be blank.');
    }
  }
}
