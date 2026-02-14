export interface GeminiGenerateOptions {
  apiKey: string;
  model: string;
  parts: Array<
    | { text: string }
    | { inline_data: { mime_type: string; data: string } }
  >;
  temperature?: number;
  responseMimeType?: string;
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

  const body = {
    contents: [
      {
        role: 'user',
        parts: options.parts,
      },
    ],
    generationConfig: {
      temperature: typeof options.temperature === 'number' ? options.temperature : 0.1,
      ...(options.responseMimeType ? { response_mime_type: options.responseMimeType } : {}),
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new GeminiHttpError(res.status, text);
  }

  let json: any;
  try {
    json = JSON.parse(text);
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
