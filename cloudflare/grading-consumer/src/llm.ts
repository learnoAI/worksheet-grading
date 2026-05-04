export interface LlmModelConfig {
  provider: string;
  model: string;
  apiKey?: string;
}

export type LlmReasoningEffort = 'low' | 'medium' | 'high';

export interface LlmGenerateOptions {
  gatewayAccountId?: string;
  gatewayId?: string;
  gatewayToken?: string;
  providerConfig: LlmModelConfig;
  parts: Array<
    | { text: string }
    | { inline_data: { mime_type: string; data: string } }
  >;
  temperature?: number;
  reasoningEffort?: LlmReasoningEffort;
  requestTimeoutMs?: number;
  responseMimeType?: string;
  responseJsonSchema?: unknown;
}

export class LlmHttpError extends Error {
  readonly status: number;
  readonly responseText: string;
  readonly provider: string;
  readonly model: string;

  constructor(status: number, responseText: string, provider: string, model: string) {
    super(`LLM request failed (${status}) [${provider}/${model}]: ${responseText}`);
    this.name = 'LlmHttpError';
    this.status = status;
    this.responseText = responseText;
    this.provider = provider;
    this.model = model;
  }
}

function hasProviderErrors(responseJson: any): responseJson is { success: false; errors: Array<{ message?: string; code?: number | string }> } {
  return responseJson?.success === false && Array.isArray(responseJson?.errors) && responseJson.errors.length > 0;
}

function stripJsonCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function parseJsonWithFallback<T>(rawText: string): T {
  const candidates: string[] = [];
  const stripped = stripJsonCodeFence(rawText);
  candidates.push(stripped);

  const firstObj = stripped.indexOf('{');
  const lastObj = stripped.lastIndexOf('}');
  if (firstObj !== -1 && lastObj > firstObj) {
    candidates.push(stripped.slice(firstObj, lastObj + 1));
  }

  const firstArr = stripped.indexOf('[');
  const lastArr = stripped.lastIndexOf(']');
  if (firstArr !== -1 && lastArr > firstArr) {
    candidates.push(stripped.slice(firstArr, lastArr + 1));
  }

  let lastErr: unknown = null;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch (e) {
      lastErr = e;
    }
  }

  const preview = stripped.length > 800 ? `${stripped.slice(0, 800)}...` : stripped;
  throw new Error(`Failed to parse LLM JSON payload: ${(lastErr as Error)?.message || String(lastErr)}. Payload preview: ${preview}`);
}

function extractText(responseJson: any): string {
  const choices = Array.isArray(responseJson?.choices) ? responseJson.choices : [];
  const firstChoice = choices[0];
  const messageContent = firstChoice?.message?.content;

  if (typeof messageContent === 'string') {
    return messageContent.trim();
  }

  if (Array.isArray(messageContent)) {
    const texts: string[] = [];
    for (const item of messageContent) {
      if (item && typeof item.text === 'string') {
        texts.push(item.text);
      }
    }
    if (texts.length > 0) {
      return texts.join('\n').trim();
    }
  }

  if (typeof responseJson?.response === 'string') {
    return responseJson.response.trim();
  }

  if (typeof responseJson?.result?.response === 'string') {
    return responseJson.result.response.trim();
  }

  return '';
}

function buildGatewayModelName(config: LlmModelConfig): string {
  const provider = config.provider.trim();
  const model = config.model.trim();

  if (!provider) {
    throw new Error('LLM provider is required');
  }

  if (!model) {
    throw new Error('LLM model is required');
  }

  return `${provider}/${model}`;
}

function buildMessages(
  parts: LlmGenerateOptions['parts']
): Array<{ role: 'user'; content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> }> {
  const hasImages = parts.some((part) => 'inline_data' in part);

  if (!hasImages) {
    const text = parts
      .filter((part): part is { text: string } => 'text' in part)
      .map((part) => part.text)
      .join('\n\n')
      .trim();

    return [{ role: 'user', content: text }];
  }

  const content = parts.map((part) => {
    if ('text' in part) {
      return {
        type: 'text' as const,
        text: part.text,
      };
    }

    return {
      type: 'image_url' as const,
      image_url: {
        url: `data:${part.inline_data.mime_type};base64,${part.inline_data.data}`,
      },
    };
  });

  return [{ role: 'user', content }];
}

function supportsResponseFormat(config: LlmModelConfig): boolean {
  if (config.provider !== 'workers-ai') {
    return false;
  }

  const supportedModels = new Set([
    '@cf/google/gemma-4-26b-a4b-it',
    '@cf/meta/llama-3.1-8b-instruct-fast',
    '@cf/meta/llama-3.1-70b-instruct',
    '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    '@cf/meta/llama-3-8b-instruct',
    '@cf/meta/llama-3.1-8b-instruct',
    '@cf/meta/llama-3.2-11b-vision-instruct',
    '@hf/nousresearch/hermes-2-pro-mistral-7b',
    '@hf/thebloke/deepseek-coder-6.7b-instruct-awq',
    '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
  ]);

  return supportedModels.has(config.model);
}

function buildResponseFormat(options: LlmGenerateOptions): unknown {
  if (
    options.responseMimeType !== 'application/json' ||
    !options.responseJsonSchema ||
    !supportsResponseFormat(options.providerConfig)
  ) {
    return undefined;
  }

  return {
    type: 'json_schema',
    json_schema: options.responseJsonSchema,
  };
}

function buildReasoningEffort(options: LlmGenerateOptions): LlmReasoningEffort | undefined {
  if (options.providerConfig.provider !== 'workers-ai') {
    return undefined;
  }

  if (!options.reasoningEffort) {
    return undefined;
  }

  return options.reasoningEffort;
}

export async function llmGenerateJson<T>(options: LlmGenerateOptions): Promise<{ parsed: T; rawText: string }> {
  const gatewayAccountId = options.gatewayAccountId?.trim();
  const gatewayToken = options.gatewayToken?.trim();
  if (!gatewayAccountId) {
    throw new Error('CF_AI_GATEWAY_ACCOUNT_ID is required');
  }

  const gatewayId = options.gatewayId?.trim() || 'default';
  const model = buildGatewayModelName(options.providerConfig);
  const url = `https://gateway.ai.cloudflare.com/v1/${gatewayAccountId}/${gatewayId}/compat/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (gatewayToken) {
    headers['cf-aig-authorization'] = `Bearer ${gatewayToken}`;
  }

  const providerApiKey =
    options.providerConfig.apiKey?.trim() ||
    (options.providerConfig.provider === 'workers-ai' ? gatewayToken : undefined);
  if (providerApiKey) {
    headers.Authorization = `Bearer ${providerApiKey}`;
  }
  if (typeof options.requestTimeoutMs === 'number' && Number.isFinite(options.requestTimeoutMs) && options.requestTimeoutMs > 0) {
    headers['cf-aig-request-timeout'] = String(Math.round(options.requestTimeoutMs));
  }

  const responseFormat = buildResponseFormat(options);
  const reasoningEffort = buildReasoningEffort(options);
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: buildMessages(options.parts),
      temperature: typeof options.temperature === 'number' ? options.temperature : 0.1,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      ...(responseFormat ? { response_format: responseFormat } : {}),
    }),
  });

  const text = await res.text();
  if (res.status < 200 || res.status >= 300) {
    throw new LlmHttpError(res.status, text, options.providerConfig.provider, options.providerConfig.model);
  }

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('LLM response was not valid JSON');
  }

  if (hasProviderErrors(json)) {
    const effectiveStatus = res.status >= 400 ? res.status : 500;
    throw new LlmHttpError(effectiveStatus, JSON.stringify({ errors: json.errors }), options.providerConfig.provider, options.providerConfig.model);
  }

  const rawText = extractText(json);
  if (!rawText) {
    throw new Error('LLM response did not include text content');
  }

  return { parsed: parseJsonWithFallback<T>(rawText), rawText };
}
