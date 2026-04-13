type PosthogProperties = Record<string, unknown>;

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';
const CAPTURE_PATH = '/capture/';
const PIPELINE_EVENT = 'grading_pipeline';

interface PosthogEnv {
  POSTHOG_API_KEY?: string;
  POSTHOG_HOST?: string;
}

function normalizeHost(host: string): string {
  return host.replace(/\/+$/, '');
}

function sanitizeProperties(properties: PosthogProperties): PosthogProperties {
  const sanitized: PosthogProperties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined) {
      continue;
    }
    if (value instanceof Date) {
      sanitized[key] = value.toISOString();
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

export function createPosthogClient(env: PosthogEnv, ctx: ExecutionContext) {
  const apiKey = env.POSTHOG_API_KEY?.trim();
  const host = normalizeHost(env.POSTHOG_HOST || DEFAULT_POSTHOG_HOST);
  const enabled = Boolean(apiKey);

  function captureEvent(event: string, distinctId: string, properties: PosthogProperties = {}): void {
    if (!enabled || !apiKey) {
      return;
    }

    const payload = {
      api_key: apiKey,
      event,
      distinct_id: distinctId,
      properties: sanitizeProperties({
        runtime: 'cloudflare_worker',
        ...properties,
      }),
    };

    const task = fetch(`${host}${CAPTURE_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }).catch(() => {
      // Telemetry is best effort; do not affect queue processing semantics.
    });

    ctx.waitUntil(task);
  }

  return {
    enabled,
    capturePipeline(stage: string, distinctId: string, properties: PosthogProperties = {}) {
      captureEvent(PIPELINE_EVENT, distinctId, {
        stage,
        ...properties,
      });
    },
  };
}

