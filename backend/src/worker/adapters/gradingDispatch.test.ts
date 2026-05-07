import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchGradingWorkflow, GradingWorkflowDispatchError } from './gradingDispatch';
import type { WorkerEnv } from '../types';

function makeBinding(
  create: (input: { id: string; params: { jobId: string } }) => Promise<{ id: string }>,
): { env: WorkerEnv; createMock: ReturnType<typeof vi.fn> } {
  const createMock = vi.fn(create);
  const env = {
    GRADING_WORKFLOW: {
      create: createMock,
      get: vi.fn(),
    },
  } as unknown as WorkerEnv;
  return { env, createMock };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('dispatchGradingWorkflow', () => {
  it('creates an instance with id = jobId and returns existed:false on first dispatch', async () => {
    const { env, createMock } = makeBinding(async ({ id }) => ({ id }));
    const out = await dispatchGradingWorkflow(env, 'job-1');
    expect(out).toEqual({ instanceId: 'job-1', existed: false });
    expect(createMock).toHaveBeenCalledWith({ id: 'job-1', params: { jobId: 'job-1' } });
  });

  it('treats a typed `code: instance_already_exists` error as success (existed:true)', async () => {
    const { env } = makeBinding(async () => {
      throw Object.assign(new Error('whatever the runtime says'), {
        code: 'instance_already_exists',
      });
    });
    const out = await dispatchGradingWorkflow(env, 'job-2');
    expect(out).toEqual({ instanceId: 'job-2', existed: true });
  });

  it('matches by message phrase when the typed code is missing', async () => {
    const { env } = makeBinding(async () => {
      throw new Error('Workflow instance with the id "job-3" already exists');
    });
    const out = await dispatchGradingWorkflow(env, 'job-3');
    expect(out).toEqual({ instanceId: 'job-3', existed: true });
  });

  it('does NOT swallow unrelated errors that happen to mention "duplicate"', async () => {
    const { env } = makeBinding(async () => {
      // e.g. a Postgres-shaped error bubbling up through some upstream
      // path we don't control. Bare 'duplicate' must not look like an
      // already-exists race or we'd silently mark a failed dispatch as
      // succeeded.
      throw new Error('duplicate key value violates unique constraint "..."');
    });
    await expect(dispatchGradingWorkflow(env, 'job-4')).rejects.toThrow(GradingWorkflowDispatchError);
  });

  it('wraps unrelated errors as GradingWorkflowDispatchError with cause preserved', async () => {
    const root = new Error('socket hang up');
    const { env } = makeBinding(async () => {
      throw root;
    });
    try {
      await dispatchGradingWorkflow(env, 'job-5');
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(GradingWorkflowDispatchError);
      expect((e as GradingWorkflowDispatchError).cause).toBe(root);
      expect((e as GradingWorkflowDispatchError).message).toContain('job-5');
      expect((e as GradingWorkflowDispatchError).message).toContain('socket hang up');
    }
  });

  it('throws a typed error when the binding is missing', async () => {
    const env = {} as WorkerEnv;
    await expect(dispatchGradingWorkflow(env, 'job-6')).rejects.toBeInstanceOf(
      GradingWorkflowDispatchError,
    );
    await expect(dispatchGradingWorkflow(env, 'job-6')).rejects.toThrow(/binding is not configured/);
  });
});
