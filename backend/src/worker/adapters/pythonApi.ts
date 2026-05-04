/**
 * Workers-native Python grading API client.
 *
 * Replaces the `node-fetch` + `form-data` stack the Express grading pipeline
 * uses (`backend/src/services/gradingExecutionService.ts`) with native
 * `fetch` and native `FormData`. The Workers runtime (and Node 18+) both
 * have these built in, so this module has zero npm deps and works
 * identically on both sides.
 *
 * Surface area intentionally narrow: the only thing the ported routes
 * (worksheet processing / Python utility lookups) need is "POST some files
 * and/or JSON to a URL, retry on transient failure, return parsed JSON".
 */

export interface PythonFile {
  filename: string;
  contentType: string;
  buffer: Uint8Array | ArrayBuffer | Blob;
}

export interface PythonApiOptions {
  method?: 'GET' | 'POST';
  query?: Record<string, string | number | undefined>;
  /** Extra headers — never set Content-Type yourself when using `files`. */
  headers?: Record<string, string>;
  /** JSON body for application/json requests. Mutually exclusive with `files` + `fields`. */
  json?: unknown;
  /** Files to upload as multipart/form-data under the `files` field. */
  files?: PythonFile[];
  /** Non-file form fields (sent only when `files` is used). */
  fields?: Record<string, string>;
  /** Total attempts including the first. Defaults to 3. */
  maxRetries?: number;
  /** Base delay for exponential backoff between retries (ms). Defaults to 1000. */
  baseDelayMs?: number;
  /** Per-request timeout (ms). Defaults to 30_000. */
  timeoutMs?: number;
  /** Called before each retry attempt — useful for keeping a job lease alive. */
  onRetry?: (attempt: number, error: Error) => void | Promise<void>;
}

export class PythonApiError extends Error {
  public readonly status?: number;
  public readonly responseText?: string;

  constructor(message: string, opts: { status?: number; responseText?: string } = {}) {
    super(message);
    this.name = 'PythonApiError';
    this.status = opts.status;
    this.responseText = opts.responseText;
  }
}

function buildUrl(baseUrl: string, query?: PythonApiOptions['query']): string {
  if (!query) return baseUrl;
  const u = new URL(baseUrl);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) u.searchParams.set(k, String(v));
  }
  return u.toString();
}

function buildBody(
  opts: PythonApiOptions
): { body: BodyInit | undefined; headers: Record<string, string> } {
  if (opts.json !== undefined) {
    return {
      body: JSON.stringify(opts.json),
      headers: { 'Content-Type': 'application/json' },
    };
  }
  if (opts.files && opts.files.length > 0) {
    const form = new FormData();
    for (const file of opts.files) {
      const blob =
        file.buffer instanceof Blob
          ? file.buffer
          : new Blob([file.buffer], { type: file.contentType });
      form.append('files', blob, file.filename);
    }
    for (const [k, v] of Object.entries(opts.fields ?? {})) {
      form.append(k, v);
    }
    // Deliberately NOT setting Content-Type — the runtime sets a proper
    // multipart boundary header when FormData is the body.
    return { body: form, headers: {} };
  }
  return { body: undefined, headers: {} };
}

function shouldRetry(status: number): boolean {
  // 5xx and 429 are transient by convention; 408 is a rare but real transient.
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POSTs (or GETs) to the given URL with the configured body, retrying up to
 * `maxRetries` times with exponential backoff on transient failures.
 *
 * Throws `PythonApiError` on terminal failure. On success returns the parsed
 * JSON body (or `null` if the response had no body).
 */
export async function callPython<T = unknown>(
  url: string,
  options: PythonApiOptions = {}
): Promise<T | null> {
  const method = options.method ?? 'POST';
  const maxRetries = options.maxRetries ?? 3;
  const baseDelay = options.baseDelayMs ?? 1000;
  const timeoutMs = options.timeoutMs ?? 30_000;

  const { body, headers } = buildBody(options);
  const fullUrl = buildUrl(url, options.query);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(fullUrl, {
        method,
        headers: { ...headers, ...(options.headers ?? {}) },
        body: method === 'GET' ? undefined : body,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const text = await safeReadText(res);
        if (shouldRetry(res.status) && attempt < maxRetries - 1) {
          lastError = new PythonApiError(`Python API returned ${res.status}`, {
            status: res.status,
            responseText: text,
          });
          await options.onRetry?.(attempt + 1, lastError);
          await sleep(baseDelay * 2 ** attempt);
          continue;
        }
        throw new PythonApiError(`Python API returned ${res.status}: ${text.slice(0, 200)}`, {
          status: res.status,
          responseText: text,
        });
      }

      if (res.status === 204) return null;
      const text = await safeReadText(res);
      if (!text) return null;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new PythonApiError('Python API returned non-JSON response', {
          status: res.status,
          responseText: text,
        });
      }
    } catch (err) {
      clearTimeout(timer);
      const isAbort = (err as { name?: string })?.name === 'AbortError';
      const isNetwork = err instanceof TypeError; // fetch network failure
      lastError = err instanceof Error ? err : new Error(String(err));
      if ((isAbort || isNetwork) && attempt < maxRetries - 1) {
        await options.onRetry?.(attempt + 1, lastError);
        await sleep(baseDelay * 2 ** attempt);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new PythonApiError('Python API call failed (unknown reason)');
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
