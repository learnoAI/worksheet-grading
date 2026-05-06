import { describe, expect, it } from 'vitest';

import { GradingResultJsonSchema } from './schemas';

describe('grading structured output schema', () => {
  it('does not ask the model for overall_feedback', () => {
    const schema = GradingResultJsonSchema as any;

    expect(schema.properties.overall_feedback).toBeUndefined();
    expect(schema.required).not.toContain('overall_feedback');
  });
});
