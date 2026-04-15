import { zValidator } from '@hono/zod-validator';
import type { ZodSchema } from 'zod';
import type { ValidationTargets } from 'hono';

/**
 * Shape we want to send back on validation failure. Matches the existing
 * Express controllers that return `{ errors: [...] }` with one entry per
 * failing field, so frontend/mobile callers don't need per-endpoint changes.
 */
interface FieldError {
  path: string;
  message: string;
  location: keyof ValidationTargets;
}

function issuesToErrors(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
  location: keyof ValidationTargets
): FieldError[] {
  return issues.map((issue) => ({
    path: issue.path.map(String).join('.') || location,
    message: issue.message,
    location,
  }));
}

/**
 * Build a Hono middleware that validates a request target (`json`, `query`,
 * `param`, `form`, `header`, `cookie`) and, on failure, responds with a 400
 * shaped like the existing Express validator output.
 *
 * Usage:
 *   app.post('/login', validate('json', loginSchema), (c) => {
 *     const body = c.req.valid('json');
 *     ...
 *   });
 */
export function validate<T extends keyof ValidationTargets>(
  target: T,
  schema: ZodSchema
) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const errors = issuesToErrors(result.error.issues, target);
      return c.json({ errors }, 400);
    }
  });
}

export const validateJson = <S extends ZodSchema>(schema: S) => validate('json', schema);
export const validateQuery = <S extends ZodSchema>(schema: S) => validate('query', schema);
export const validateParams = <S extends ZodSchema>(schema: S) => validate('param', schema);
export const validateForm = <S extends ZodSchema>(schema: S) => validate('form', schema);
