import { describe, expect, it } from 'vitest';

import { buildExceptionProperties, parseStackFrames } from './posthogService';

describe('parseStackFrames', () => {
  it('returns an empty array when stack is undefined', () => {
    expect(parseStackFrames(undefined)).toEqual([]);
  });

  it('parses named V8 frames with filename/line/column', () => {
    const stack = [
      'Error: boom',
      '    at doThing (/app/src/services/foo.ts:42:15)',
      '    at handler (/app/src/routes/bar.ts:10:3)',
    ].join('\n');

    expect(parseStackFrames(stack)).toEqual([
      { function: 'doThing', filename: '/app/src/services/foo.ts', lineno: 42, colno: 15, in_app: true },
      { function: 'handler', filename: '/app/src/routes/bar.ts', lineno: 10, colno: 3, in_app: true },
    ]);
  });

  it('parses async frames and anonymous frames', () => {
    const stack = [
      'Error: boom',
      '    at async doThing (/app/src/a.ts:1:2)',
      '    at /app/src/b.ts:3:4',
    ].join('\n');

    expect(parseStackFrames(stack)).toEqual([
      { function: 'doThing', filename: '/app/src/a.ts', lineno: 1, colno: 2, in_app: true },
      { function: '<anonymous>', filename: '/app/src/b.ts', lineno: 3, colno: 4, in_app: true },
    ]);
  });

  it('marks node_modules and node: frames as not in_app', () => {
    const stack = [
      'Error: boom',
      '    at fetch (/app/node_modules/node-fetch/lib/index.js:5:5)',
      '    at processTicksAndRejections (node:internal/process/task_queues:96:5)',
      '    at appCode (/app/src/x.ts:7:8)',
    ].join('\n');

    const frames = parseStackFrames(stack);
    expect(frames.map((f) => f.in_app)).toEqual([false, false, true]);
  });
});

describe('buildExceptionProperties', () => {
  it('builds a $exception_list payload from an Error instance', () => {
    const err = new Error('something failed');
    err.stack = [
      'Error: something failed',
      '    at worker (/app/src/workers/x.ts:12:7)',
    ].join('\n');

    const props = buildExceptionProperties(err, { distinctId: 'job-1', stage: 'worker_failed' });

    expect(props.$exception_type).toBe('Error');
    expect(props.$exception_message).toBe('something failed');
    expect(props.$exception_source).toBe('worker_failed');
    expect(props.stage).toBe('worker_failed');
    expect(Array.isArray(props.$exception_list)).toBe(true);

    const list = props.$exception_list as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(list[0].type).toBe('Error');
    expect(list[0].value).toBe('something failed');
    expect(list[0].mechanism).toEqual({ type: 'generic', handled: true, synthetic: false });

    const stacktrace = list[0].stacktrace as { type: string; frames: unknown[] };
    expect(stacktrace.type).toBe('resolved');
    expect(stacktrace.frames).toHaveLength(1);
  });

  it('preserves the subclass name (TypeError) on the exception type', () => {
    const err = new TypeError('bad arg');
    const props = buildExceptionProperties(err, { distinctId: 'd' });
    expect(props.$exception_type).toBe('TypeError');
    const list = props.$exception_list as Array<Record<string, unknown>>;
    expect(list[0].type).toBe('TypeError');
  });

  it('wraps non-Error throws and marks them synthetic', () => {
    const props = buildExceptionProperties('just a string', { distinctId: 'd' });
    const list = props.$exception_list as Array<Record<string, unknown>>;
    expect(list[0].value).toBe('just a string');
    expect(list[0].mechanism).toEqual({ type: 'generic', handled: true, synthetic: true });
    const stacktrace = list[0].stacktrace as { frames: unknown[] };
    expect(stacktrace.frames).toEqual([]);
  });

  it('serialises object throws to JSON', () => {
    const props = buildExceptionProperties({ code: 42, why: 'nope' }, { distinctId: 'd' });
    const list = props.$exception_list as Array<Record<string, unknown>>;
    expect(list[0].value).toBe('{"code":42,"why":"nope"}');
  });

  it('omits stage and fingerprint when not provided', () => {
    const props = buildExceptionProperties(new Error('x'), { distinctId: 'd' });
    expect(props).not.toHaveProperty('$exception_source');
    expect(props).not.toHaveProperty('$exception_fingerprint');
    expect(props).not.toHaveProperty('stage');
  });

  it('passes through fingerprint and extra context', () => {
    const props = buildExceptionProperties(new Error('x'), {
      distinctId: 'd',
      fingerprint: 'grade-save-deadlock',
      extra: { jobId: 'job-7', retries: 3 },
    });
    expect(props.$exception_fingerprint).toBe('grade-save-deadlock');
    expect(props.jobId).toBe('job-7');
    expect(props.retries).toBe(3);
  });

  it('returns empty frames for an Error without a stack', () => {
    const err = new Error('no stack');
    err.stack = undefined;
    const props = buildExceptionProperties(err, { distinctId: 'd' });
    const list = props.$exception_list as Array<Record<string, unknown>>;
    const stacktrace = list[0].stacktrace as { frames: unknown[] };
    expect(stacktrace.frames).toEqual([]);
  });
});
