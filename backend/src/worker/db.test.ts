import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the heavy Prisma modules and `pg` so these tests don't need the
// generated client or a native postgres binary loaded. Classes are used
// (not `vi.fn`) so that `new PrismaPg(...)` / `new PrismaClient(...)` /
// `new pg.Pool(...)` inside `db.ts` work correctly.
const prismaPgCalls: unknown[] = [];
const prismaClientCalls: unknown[] = [];
const poolCalls: unknown[] = [];

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

vi.mock('pg', () => {
  class FakePool {
    config: unknown;
    constructor(config: unknown) {
      this.config = config;
      poolCalls.push(config);
    }
    end() {
      return Promise.resolve();
    }
  }
  return { default: { Pool: FakePool }, Pool: FakePool };
});

import { createPrismaClient } from './db';

describe('createPrismaClient', () => {
  beforeEach(() => {
    prismaPgCalls.length = 0;
    prismaClientCalls.length = 0;
    poolCalls.length = 0;
  });

  it('uses DATABASE_URL when HYPERDRIVE is not provided', () => {
    const client = createPrismaClient({ DATABASE_URL: 'postgres://localhost:5432/foo' });

    expect(poolCalls).toEqual([
      {
        connectionString: 'postgres://localhost:5432/foo',
        max: 3,
        idleTimeoutMillis: 0,
      },
    ]);
    expect(prismaPgCalls.length).toBe(1);
    expect(prismaClientCalls.length).toBe(1);
    expect((client as unknown as { __isPrismaClient: boolean }).__isPrismaClient).toBe(true);
  });

  it('prefers HYPERDRIVE connectionString over DATABASE_URL', () => {
    createPrismaClient({
      DATABASE_URL: 'postgres://ignored',
      HYPERDRIVE: { connectionString: 'postgres://hyperdrive/foo' },
    });

    expect(poolCalls.length).toBe(1);
    expect((poolCalls[0] as { connectionString: string }).connectionString).toBe(
      'postgres://hyperdrive/foo'
    );
  });

  it('builds a fresh pool on every call (no module-level caching)', () => {
    createPrismaClient({ DATABASE_URL: 'postgres://localhost:5432/foo' });
    createPrismaClient({ DATABASE_URL: 'postgres://localhost:5432/foo' });
    createPrismaClient({ DATABASE_URL: 'postgres://localhost:5432/foo' });

    expect(poolCalls.length).toBe(3);
  });

  it('throws a clear error when no connection string is available', () => {
    expect(() => createPrismaClient({})).toThrow(/No database connection string/);
  });
});
