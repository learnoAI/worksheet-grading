import { describe, expect, it, vi } from 'vitest';

// Mock the heavy Prisma modules so these tests don't need the generated client
// or a native postgres binary loaded.
vi.mock('@prisma/client', () => {
  return {
    PrismaClient: vi.fn().mockImplementation((opts: unknown) => ({
      __isPrismaClient: true,
      __constructorArgs: opts,
    })),
  };
});

vi.mock('@prisma/adapter-pg', () => {
  return {
    PrismaPg: vi.fn().mockImplementation((opts: unknown) => ({
      __isPrismaPg: true,
      __constructorArgs: opts,
    })),
  };
});

import { createPrismaClient } from './db';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

describe('createPrismaClient', () => {
  it('uses DATABASE_URL when HYPERDRIVE is not provided', () => {
    const client = createPrismaClient({ DATABASE_URL: 'postgres://localhost:5432/foo' });

    expect(PrismaPg).toHaveBeenCalledWith({ connectionString: 'postgres://localhost:5432/foo' });
    expect(PrismaClient).toHaveBeenCalledTimes(1);
    expect((client as unknown as { __isPrismaClient: boolean }).__isPrismaClient).toBe(true);
  });

  it('prefers HYPERDRIVE connectionString over DATABASE_URL', () => {
    vi.mocked(PrismaPg).mockClear();
    createPrismaClient({
      DATABASE_URL: 'postgres://ignored',
      HYPERDRIVE: { connectionString: 'postgres://hyperdrive/foo' },
    });
    expect(PrismaPg).toHaveBeenCalledWith({ connectionString: 'postgres://hyperdrive/foo' });
  });

  it('throws a clear error when no connection string is available', () => {
    expect(() => createPrismaClient({})).toThrow(/No database connection string/);
  });
});
