// Test-only stub for `cloudflare:workers`. The real module is supplied by
// the Workers runtime; under Node + Vitest we just need import resolution
// to succeed. Anything used at runtime (WorkflowEntrypoint base class
// behavior) should be mocked at the test level.

export class WorkflowEntrypoint<_Env = unknown, _Params = unknown> {
  constructor(public ctx: unknown, public env: _Env) {}
}

export interface WorkflowEvent<T> {
  payload: T;
}

export interface WorkflowStep {
  do<T>(name: string, configOrFn: unknown, fn?: () => Promise<T>): Promise<T>;
  sleep(name: string, duration: string): Promise<void>;
}

export interface WorkflowStepConfig {
  retries?: { limit: number; delay: string; backoff: string };
  timeout?: string;
}
