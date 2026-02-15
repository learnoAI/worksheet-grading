export interface GeminiGenerateOptions {
  apiKey: string;
  model: string;
  parts: Array<
    | { text: string }
    | { inline_data: { mime_type: string; data: string } }
  >;
  temperature?: number;
  responseMimeType?: string;
  responseJsonSchema?: unknown;
}

export class GeminiHttpError extends Error {
  readonly status: number;
  readonly responseText: string;

  constructor(status: number, responseText: string) {
    super(`Gemini request failed (${status}): ${responseText}`);
    this.name = 'GeminiHttpError';
    this.status = status;
    this.responseText = responseText;
  }
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
  throw new Error(`Failed to parse Gemini JSON payload: ${(lastErr as Error)?.message || String(lastErr)}. Payload preview: ${preview}`);
}

function extractText(responseJson: any): string {
  const candidates = Array.isArray(responseJson?.candidates) ? responseJson.candidates : [];
  const first = candidates[0];
  const parts = Array.isArray(first?.content?.parts) ? first.content.parts : [];
  const texts: string[] = [];

  for (const part of parts) {
    if (part && typeof part.text === 'string') {
      texts.push(part.text);
    }
  }

  return texts.join('\n').trim();
}

export async function geminiGenerateJson<T>(options: GeminiGenerateOptions): Promise<{ parsed: T; rawText: string }> {
  const apiKey = options.apiKey;
  const model = options.model;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const baseBody = {
    contents: [
      {
        role: 'user',
        parts: options.parts,
      },
    ],
  };

  // Gemini REST docs show GenerationConfig uses lowerCamelCase JSON keys.
  // Some tooling/docs mention snake_case; we keep a narrow fallback for compatibility.
  const generationConfigCamel = {
    temperature: typeof options.temperature === 'number' ? options.temperature : 0.1,
    ...(options.responseMimeType ? { responseMimeType: options.responseMimeType } : {}),
    ...(options.responseJsonSchema ? { responseJsonSchema: options.responseJsonSchema } : {}),
  };

  const generationConfigSnake = {
    temperature: typeof options.temperature === 'number' ? options.temperature : 0.1,
    ...(options.responseMimeType ? { response_mime_type: options.responseMimeType } : {}),
    ...(options.responseJsonSchema ? { response_json_schema: options.responseJsonSchema } : {}),
  };

  async function doFetch(generationConfig: Record<string, unknown>): Promise<{ status: number; text: string }> {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        ...baseBody,
        generationConfig,
      }),
    });
    const text = await res.text();
    return { status: res.status, text };
  }

  let response = await doFetch(generationConfigCamel);
  if (response.status === 400) {
    const looksLikeUnknownField =
      response.text.includes('Unknown name') &&
      (response.text.includes('responseMimeType') || response.text.includes('responseJsonSchema'));
    if (looksLikeUnknownField) {
      response = await doFetch(generationConfigSnake);
    }
  }

  if (response.status < 200 || response.status >= 300) {
    throw new GeminiHttpError(response.status, response.text);
  }

  let json: any;
  try {
    json = JSON.parse(response.text);
  } catch {
    throw new Error('Gemini response was not valid JSON');
  }

  const rawText = extractText(json);
  if (!rawText) {
    throw new Error('Gemini response did not include text content');
  }

  return { parsed: parseJsonWithFallback<T>(rawText), rawText };
}
