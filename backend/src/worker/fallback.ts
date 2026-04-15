import type { MiddlewareHandler } from 'hono';
import type { AppBindings } from './types';

/**
 * Proxy-to-Express fallback.
 *
 * Phase 5.11 ported ~75 endpoints to Hono; ~20 remain on Express (see C9
 * in the migration plan — complex worksheet uploads, grading-worker
 * internal routes, heavy analytics, etc.). This middleware is mounted
 * *last* so it only runs when Hono has no matching route: it forwards the
 * original request to the Express service and streams the response back.
 *
 * Config:
 *   - `EXPRESS_FALLBACK_URL` (required) — e.g.
 *     `https://king-prawn-app-k2urh.ondigitalocean.app/worksheet-grading-backend`
 *     (no trailing slash; the worker's path is appended as-is).
 *
 * Behavior:
 *   - If the env var is missing, returns 404 with a clear error so the
 *     misconfiguration is obvious in dev.
 *   - Preserves method, headers, body, and query string.
 *   - Strips hop-by-hop headers on both sides to avoid RFC-7230 pitfalls.
 *   - Adds `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto` so
 *     the Express side can log origin details.
 *
 * Hop-by-hop headers — per RFC 7230 §6.1 — must not be forwarded. We
 * filter them on the way in and out.
 */
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  // Cloudflare-managed headers that must not be forwarded verbatim.
  'cf-connecting-ip',
  'cf-ray',
  'cf-visitor',
]);

function copyHeaders(src: Headers, filter: (name: string) => boolean): Headers {
  const out = new Headers();
  src.forEach((value, name) => {
    if (filter(name.toLowerCase())) out.append(name, value);
  });
  return out;
}

/**
 * Builds the fallback middleware. Declared as a factory so tests can
 * inject a stub `fetch` implementation without patching the global.
 */
export function expressFallback(options: {
  fetchImpl?: typeof fetch;
} = {}): MiddlewareHandler<AppBindings> {
  const doFetch = options.fetchImpl ?? fetch;

  return async (c) => {
    const upstream = c.env?.EXPRESS_FALLBACK_URL;
    if (!upstream) {
      return c.json(
        {
          error:
            'EXPRESS_FALLBACK_URL is not configured. Deferred Phase 5.13 routes cannot be proxied.',
        },
        404
      );
    }

    const incoming = c.req.raw;
    const incomingUrl = new URL(incoming.url);

    // Join upstream base + worker path + preserved query string.
    const base = upstream.replace(/\/+$/, '');
    const upstreamUrl = `${base}${incomingUrl.pathname}${incomingUrl.search}`;

    // Build forwarded headers: drop hop-by-hop, add X-Forwarded-*.
    const headers = copyHeaders(incoming.headers, (n) => !HOP_BY_HOP_HEADERS.has(n));
    const clientIp = incoming.headers.get('cf-connecting-ip') ?? incoming.headers.get('x-forwarded-for');
    if (clientIp) headers.set('x-forwarded-for', clientIp);
    headers.set('x-forwarded-host', incomingUrl.hostname);
    headers.set('x-forwarded-proto', incomingUrl.protocol.replace(/:$/, ''));
    // Let Express know this request came through the Hono worker. Useful for
    // diagnostics and to avoid infinite loops if Express ever proxies back.
    headers.set('x-forwarded-via', 'hono-worker');

    let upstreamRes: Response;
    try {
      upstreamRes = await doFetch(upstreamUrl, {
        method: incoming.method,
        headers,
        body: bodylessMethod(incoming.method) ? undefined : incoming.body,
        redirect: 'manual',
        // Cloudflare Workers: must set duplex: 'half' when sending a stream body.
        // @ts-expect-error Workers runtime supports duplex; tsc lib.dom.d.ts lags.
        duplex: 'half',
      });
    } catch (err) {
      console.error('[fallback] upstream fetch failed:', err);
      return c.json(
        {
          error: 'Upstream Express service is unreachable',
          detail: err instanceof Error ? err.message : String(err),
        },
        502
      );
    }

    // Strip hop-by-hop from the response too before streaming back.
    const resHeaders = copyHeaders(
      upstreamRes.headers,
      (n) => !HOP_BY_HOP_HEADERS.has(n)
    );

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: resHeaders,
    });
  };
}

function bodylessMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m === 'GET' || m === 'HEAD';
}
