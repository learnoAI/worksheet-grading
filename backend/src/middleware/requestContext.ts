import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
    requestId: string;
    // Reserved for later phases (identity + session replay correlation).
    sessionId?: string;
    userId?: string;
}

// Shared ALS instance — imported by both the Express middleware (to set the
// context) and the PostHog service (to read it). `async_hooks` is a built-in
// Node module, no new dependency.
export const requestContextStore = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
    return requestContextStore.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
    return requestContextStore.getStore();
}
