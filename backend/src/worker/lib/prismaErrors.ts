/**
 * Helpers to recognize Prisma's known-error codes by string match. Importing
 * `PrismaClientKnownRequestError` directly pulls the runtime types into the
 * worker bundle and bloats deploy size, so we duck-type instead.
 *
 * Used to make handlers Hyperdrive-cache safe: rather than `findUnique →
 * check → mutate` (which races against Hyperdrive's stale read cache), we
 * mutate directly and translate the resulting Prisma error into the right
 * HTTP status. See `routes/analytics.ts` for the canonical usage and
 * `fix(worker): make analytics student-class handlers Hyperdrive-cache safe`
 * for the rationale.
 */

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === code
  );
}

/**
 * P2002 — "Unique constraint failed on the {constraint}". Use to translate
 * a duplicate-create attempt into a 400/409 without a stale-prone pre-check.
 */
export function isUniqueConstraintError(error: unknown): boolean {
  return hasCode(error, 'P2002');
}

/**
 * P2025 — "An operation failed because it depends on one or more records
 * that were required but not found". Use to translate a "row vanished"
 * update/delete into a 404 without a stale-prone pre-check.
 */
export function isRecordNotFoundError(error: unknown): boolean {
  return hasCode(error, 'P2025');
}

/**
 * P2003 — "Foreign key constraint failed on the field". Use when a create
 * or update points at a parent row whose existence we don't pre-check.
 */
export function isForeignKeyConstraintError(error: unknown): boolean {
  return hasCode(error, 'P2003');
}
