import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LlmHttpError, llmGenerateJson } from './llm';

describe('llmGenerateJson', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('routes Workers AI requests through AI Gateway compat with multimodal content', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: '{"questions":[]}',
          },
        },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock as any);

    await llmGenerateJson<{ questions: unknown[] }>({
      gatewayAccountId: 'acct-123',
      gatewayId: 'grading',
      gatewayToken: 'cf-token',
      providerConfig: {
        provider: 'workers-ai',
        model: '@cf/google/gemma-4-26b-a4b-it',
      },
      reasoningEffort: 'low',
      requestTimeoutMs: 180000,
      responseMimeType: 'application/json',
      responseJsonSchema: { type: 'object' },
      parts: [
        { text: 'Extract the worksheet.' },
        {
          inline_data: {
            mime_type: 'image/jpeg',
            data: 'AQID',
          },
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined];
    const url = firstCall[0];
    const init = firstCall[1]!;
    expect(String(url)).toBe('https://gateway.ai.cloudflare.com/v1/acct-123/grading/compat/chat/completions');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'cf-aig-authorization': 'Bearer cf-token',
      Authorization: 'Bearer cf-token',
    });

    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('workers-ai/@cf/google/gemma-4-26b-a4b-it');
    expect(body.reasoning_effort).toBe('low');
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { type: 'object' },
    });
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extract the worksheet.' },
          {
            type: 'image_url',
            image_url: {
              url: 'data:image/jpeg;base64,AQID',
            },
          },
        ],
      },
    ]);
    expect(init.headers).toMatchObject({
      'cf-aig-request-timeout': '180000',
    });
  });

  it('adds provider authorization and response_format when supported', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: '{"ok":true}',
          },
        },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock as any);

    await llmGenerateJson<{ ok: boolean }>({
      gatewayAccountId: 'acct-123',
      gatewayToken: 'cf-token',
      providerConfig: {
        provider: 'workers-ai',
        model: '@cf/meta/llama-3.2-11b-vision-instruct',
        apiKey: 'provider-key',
      },
      reasoningEffort: 'low',
      requestTimeoutMs: 90000,
      responseMimeType: 'application/json',
      responseJsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
      parts: [{ text: 'Return json.' }],
    });

    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined];
    const init = firstCall[1]!;
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer provider-key',
      'cf-aig-authorization': 'Bearer cf-token',
      'cf-aig-request-timeout': '90000',
    });

    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('workers-ai/@cf/meta/llama-3.2-11b-vision-instruct');
    expect(body.reasoning_effort).toBe('low');
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
    });
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: 'Return json.',
      },
    ]);
  });

  it('omits gateway auth header when no gateway token is configured', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: '{"ok":true}',
          },
        },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock as any);

    await llmGenerateJson<{ ok: boolean }>({
      gatewayAccountId: 'acct-123',
      gatewayId: 'learnoai',
      providerConfig: {
        provider: 'workers-ai',
        model: '@cf/google/gemma-4-26b-a4b-it',
      },
      parts: [{ text: 'Return json.' }],
    });

    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined];
    const init = firstCall[1]!;
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
    });
    expect((init.headers as Record<string, string>)['cf-aig-authorization']).toBeUndefined();
  });

  it('reuses the gateway token as Workers AI provider auth when no provider api key is set', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: '{"ok":true}',
          },
        },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock as any);

    await llmGenerateJson<{ ok: boolean }>({
      gatewayAccountId: 'acct-123',
      gatewayId: 'learnoai',
      gatewayToken: 'cf-token',
      providerConfig: {
        provider: 'workers-ai',
        model: '@cf/google/gemma-4-26b-a4b-it',
      },
      parts: [{ text: 'Return json.' }],
    });

    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined];
    const init = firstCall[1]!;
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'cf-aig-authorization': 'Bearer cf-token',
      Authorization: 'Bearer cf-token',
    });
  });

  it('omits reasoning for non-Workers-AI providers', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: '{"ok":true}',
          },
        },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock as any);

    await llmGenerateJson<{ ok: boolean }>({
      gatewayAccountId: 'acct-123',
      gatewayToken: 'cf-token',
      providerConfig: {
        provider: 'openai',
        model: 'gpt-4.1-mini',
        apiKey: 'openai-key',
      },
      reasoningEffort: 'low',
      parts: [{ text: 'Return json.' }],
    });

    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined];
    const body = JSON.parse(String(firstCall[1]!.body));
    expect(body.reasoning_effort).toBeUndefined();
  });

  it('treats Cloudflare provider error payloads as retryable LLM errors even when the HTTP wrapper is 200', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: false,
      errors: [
        {
          message: 'AiError: AiError: Internal server error (4be0e78c-1983-4a52-9e2b-c270eadc341d)',
          code: 3043,
        },
      ],
      result: {},
      messages: [],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock as any);

    await expect(
      llmGenerateJson<{ ok: boolean }>({
        gatewayAccountId: 'acct-123',
        gatewayToken: 'cf-token',
        providerConfig: {
          provider: 'workers-ai',
          model: '@cf/google/gemma-4-26b-a4b-it',
        },
        parts: [{ text: 'Return json.' }],
      })
    ).rejects.toEqual(expect.objectContaining({
      name: 'LlmHttpError',
      status: 500,
    } satisfies Partial<LlmHttpError>));
  });
});
