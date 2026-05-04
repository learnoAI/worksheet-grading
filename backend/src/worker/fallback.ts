import type { MiddlewareHandler } from 'hono';
import type { AppBindings } from './types';

/**
 * Proxy-to-Express fallback.
 *
 * All Express routes have been ported to Hono — this fallback exists as a
 * safety net for any path the worker does not match (typically a typo or a
 * route added on the Express side after the Hono port). With the catch-all
 * Hono routes in place, this middleware is mounted *last* and forwards the
 * original request to the Express service when configured. In a fully
 * cut-over environment, `EXPRESS_FALLBACK_URL` can be left unset and any
 * unmatched request will return a clear 404.
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
 *
 * `host` is not technically hop-by-hop, but the inbound `Host` is the
 * worker's own hostname (e.g. `*.workers.dev`); forwarding it to Express
 * on a different origin (`*.ondigitalocean.app`) confuses upstream
 * routing and virtual-host resolution. Dropping it lets `fetch` infer
 * the correct Host from the target URL.
 *
 * `cookie` / `set-cookie` are dropped because the worker and Express
 * live on different domains. Browser cookies are scoped to the worker's
 * domain — forwarding them verbatim is a cross-origin credential leak
 * (Express, its logs, or any intermediary would see tokens that were
 * not meant for that origin). Express does not use cookie-based auth
 * (`Authorization: Bearer …` is the auth path), so stripping these
 * doesn't break any flow.
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
  // Not hop-by-hop, but must not be forwarded across origins (see above).
  'host',
  'cookie',
  'set-cookie',
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
            'EXPRESS_FALLBACK_URL is not configured. No matching route on the worker.',
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
