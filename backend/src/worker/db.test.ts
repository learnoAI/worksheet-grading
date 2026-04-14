import { describe, expect, it, vi } from 'vitest';

// Mock the heavy Prisma modules so these tests don't need the generated client
// or a native postgres binary loaded. Classes are used (not `vi.fn`) so that
// `new PrismaPg(...)` / `new PrismaClient(...)` inside `db.ts` work correctly.
const prismaPgCalls: unknown[] = [];
const prismaClientCalls: unknown[] = [];

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: class {
    constructor(opts: unknown) {
      prismaPgCalls.push(opts);
    }
  },
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    __isPrismaClient = true;
    constructor(opts: unknown) {
      prismaClientCalls.push(opts);
    }
  },
}));

import { createPrismaClient } from './db';

describe('createPrismaClient', () => {
  it('uses DATABASE_URL when HYPERDRIVE is not provided', () => {
    prismaPgCalls.length = 0;
    prismaClientCalls.length = 0;

    const client = createPrismaClient({ DATABASE_URL: 'postgres://localhost:5432/foo' });

    expect(prismaPgCalls).toEqual([{ connectionString: 'postgres://localhost:5432/foo' }]);
    expect(prismaClientCalls.length).toBe(1);
    expect((client as unknown as { __isPrismaClient: boolean }).__isPrismaClient).toBe(true);
  });

  it('prefers HYPERDRIVE connectionString over DATABASE_URL', () => {
    prismaPgCalls.length = 0;

    createPrismaClient({
      DATABASE_URL: 'postgres://ignored',
      HYPERDRIVE: { connectionString: 'postgres://hyperdrive/foo' },
    });

    expect(prismaPgCalls).toEqual([{ connectionString: 'postgres://hyperdrive/foo' }]);
  });

  it('throws a clear error when no connection string is available', () => {
    expect(() => createPrismaClient({})).toThrow(/No database connection string/);
  });
});
