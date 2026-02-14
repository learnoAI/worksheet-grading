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
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

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
      headers: { 'Content-Type': 'application/json' },
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

  try {
    return { parsed: JSON.parse(rawText) as T, rawText };
  } catch (e) {
    const preview = rawText.length > 800 ? `${rawText.slice(0, 800)}...` : rawText;
    throw new Error(`Failed to parse Gemini JSON payload: ${(e as Error).message}. Payload preview: ${preview}`);
  }
}
