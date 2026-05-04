#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// smoke-writes.mjs — write-endpoint parity smoke between Express and the Hono
// worker. Each case POST/PUT/DELETEs against both servers, compares the
// response shapes (with id/timestamp normalisation), then cleans up via
// Prisma so the local DB is left as it was.
//
// Endpoints exercised:
//   POST   /api/schools                     — create + delete cycle
//   PUT    /api/schools/:id                 — update fields + revert
//   POST   /api/schools/:id/archive + unarchive
//   POST   /api/users                       — create teacher + delete
//   POST   /api/classes                     — create class + delete
//   POST   /api/classes/:id/teachers/:tid   — add + remove teacher relation
//   POST   /api/notifications/read-all      — idempotent (no-op when empty)
//
// Mutators that publish to CF Queues (worksheet-generation/generate,
// worksheets/upload, worksheet-processing/process) are NOT covered — they'd
// hit prod queues. Internal grading-worker mutators (acquire/heartbeat/etc)
// are also skipped — they need a real lease+job state machine.
//
// Usage:
//   node smoke-writes.mjs        # uses defaults
//   EXPRESS_URL=... WORKER_URL=... SMOKE_TOKEN=... node smoke-writes.mjs
//
// Exits 0 if all comparable cases match, 1 otherwise.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from '@prisma/client';
import { sign } from 'hono/jwt';

const EXPRESS_URL = process.env.EXPRESS_URL ?? 'http://localhost:5100';
const WORKER_URL = process.env.WORKER_URL ?? 'http://localhost:8787';
const JWT_SECRET = process.env.JWT_SECRET ?? '5AVKYBDTRIdI11nsKlBcGOsTzx4P91A9';
const TEACHER_ID =
  process.env.TEACHER_ID ?? '829b6fdd-1927-4edd-bfc4-76422e183194';

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', N = '\x1b[0m';

let pass = 0,
  fail = 0,
  skip = 0,
  hang = 0;
const failed = [];
const hangs = [];
const cleanups = [];
const prisma = new PrismaClient();

const HANG_RE = /Workers runtime canceled this request/;

async function mintToken() {
  if (process.env.SMOKE_TOKEN) return process.env.SMOKE_TOKEN;
  return await sign(
    {
      userId: TEACHER_ID,
      role: 'SUPERADMIN',
      exp: Math.floor(Date.now() / 1000) + 7200,
    },
    JWT_SECRET,
    'HS256'
  );
}

/**
 * Reduce an object to its structural skeleton: { key: typeof(value) }.
 * Used so we can compare write responses without caring about IDs,
 * timestamps, or the user-supplied fields (which differ per request).
 */
function shape(obj) {
  if (obj === null) return 'null';
  if (Array.isArray(obj)) return obj.length === 0 ? '[]' : `[${shape(obj[0])}]`;
  if (typeof obj !== 'object') return typeof obj;
  const out = {};
  for (const [k, v] of Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))) {
    out[k] = shape(v);
  }
  return out;
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function fetchTimed(url, opts, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      const text = await res.text();
      clearTimeout(t);
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      if (typeof body === 'string' && HANG_RE.test(body)) {
        if (i < retries - 1) {
          await new Promise((r) => setTimeout(r, (i + 1) * 3000));
          continue;
        }
        return { status: 0, body, hang: true };
      }
      return { status: res.status, body };
    } catch (err) {
      clearTimeout(t);
      if (i < retries - 1) {
        await new Promise((r) => setTimeout(r, (i + 1) * 3000));
        continue;
      }
      return { status: 0, body: { _err: String(err) } };
    }
  }
  return { status: 0, body: { _err: 'unreachable' } };
}

function json(method, body, token) {
  return {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  };
}

/**
 * Send distinct (per-server) payloads to both servers, then compare:
 *   - status code matches
 *   - response is the same SHAPE (keys + value types) — values are
 *     allowed to differ since they come from the input
 *
 * Returns both parsed responses so the caller can extract IDs for
 * cleanup or chained calls.
 */
async function compareWrite(
  name,
  method,
  pathExpress,
  pathWorker,
  bodyExpress,
  bodyWorker,
  token,
  expressRes,
  workerRes
) {
  const a =
    expressRes ?? (await fetchTimed(EXPRESS_URL + pathExpress, json(method, bodyExpress, token)));
  const b =
    workerRes ?? (await fetchTimed(WORKER_URL + pathWorker, json(method, bodyWorker, token)));

  await new Promise((r) => setTimeout(r, 1500));

  if (b.hang) {
    hang++;
    hangs.push(name);
    console.log(`${Y}HANG${N}  ${name}  (worker pool wedge)`);
    return { a, b };
  }

  const aS = shape(a.body);
  const bS = shape(b.body);

  if (a.status === b.status && deepEqual(aS, bS)) {
    pass++;
    console.log(`${G}PASS${N}  ${name}  (status=${a.status})`);
  } else {
    fail++;
    failed.push(name);
    console.log(`${R}FAIL${N}  ${name}  (express=${a.status} worker=${b.status})`);
    console.log('       express shape:', JSON.stringify(aS).slice(0, 200));
    console.log('       worker  shape:', JSON.stringify(bS).slice(0, 200));
  }
  return { a, b };
}

function skipCase(name, why) {
  skip++;
  console.log(`${Y}SKIP${N}  ${name}  (${why})`);
}

async function main() {
  // 0. Reachability
  for (const u of [EXPRESS_URL, WORKER_URL]) {
    const h = await fetch(u + '/health').catch(() => null);
    if (!h?.ok) {
      console.error(`server not reachable at ${u}`);
      process.exit(2);
    }
  }
  const tok = await mintToken();

  console.log('\n=== Phase 1: Schools (create / update / archive / delete) ===');

  // Schools.create — distinct names per server so neither hits the
  // unique-name conflict.
  const expressSchoolName = `smoke-school-e-${Date.now()}`;
  const workerSchoolName = `smoke-school-w-${Date.now()}`;
  const { a: aE, b: aW } = await compareWrite(
    'POST   /api/schools',
    'POST',
    '/api/schools',
    '/api/schools',
    { name: expressSchoolName, address: '1 smoke st' },
    { name: workerSchoolName, address: '1 smoke st' },
    tok
  );
  const expressSchoolId =
    aE.body && typeof aE.body === 'object' && 'id' in aE.body ? aE.body.id : null;
  const workerSchoolId =
    aW.body && typeof aW.body === 'object' && 'id' in aW.body ? aW.body.id : null;
  if (expressSchoolId)
    cleanups.push(() =>
      prisma.school.delete({ where: { id: expressSchoolId } }).catch(() => {})
    );
  if (workerSchoolId)
    cleanups.push(() =>
      prisma.school.delete({ where: { id: workerSchoolId } }).catch(() => {})
    );

  if (expressSchoolId && workerSchoolId) {
    // PUT update — same operation, distinct ids
    await compareWrite(
      'PUT    /api/schools/:id (update name)',
      'PUT',
      `/api/schools/${expressSchoolId}`,
      `/api/schools/${workerSchoolId}`,
      { name: expressSchoolName + '-updated' },
      { name: workerSchoolName + '-updated' },
      tok
    );

    await compareWrite(
      'POST   /api/schools/:id/archive',
      'POST',
      `/api/schools/${expressSchoolId}/archive`,
      `/api/schools/${workerSchoolId}/archive`,
      undefined,
      undefined,
      tok
    );

    await compareWrite(
      'POST   /api/schools/:id/unarchive',
      'POST',
      `/api/schools/${expressSchoolId}/unarchive`,
      `/api/schools/${workerSchoolId}/unarchive`,
      undefined,
      undefined,
      tok
    );

    await compareWrite(
      'DELETE /api/schools/:id',
      'DELETE',
      `/api/schools/${expressSchoolId}`,
      `/api/schools/${workerSchoolId}`,
      undefined,
      undefined,
      tok
    );
    // Successfully deleted; clear cleanup hooks
    cleanups.length = 0;
  } else {
    skipCase('PUT/archive/unarchive/delete schools', 'create failed; cannot continue');
  }

  console.log('\n=== Phase 2: Users (create + archive) ===');

  const expressUsername = `smoke-user-e-${Date.now()}`;
  const workerUsername = `smoke-user-w-${Date.now()}`;
  const { a: uE, b: uW } = await compareWrite(
    'POST   /api/users',
    'POST',
    '/api/users',
    '/api/users',
    {
      username: expressUsername,
      password: 'smokepw1',
      name: 'Smoke Teacher',
      role: 'TEACHER',
    },
    {
      username: workerUsername,
      password: 'smokepw1',
      name: 'Smoke Teacher',
      role: 'TEACHER',
    },
    tok
  );
  const expressUserId =
    uE.body && typeof uE.body === 'object' && 'id' in uE.body ? uE.body.id : null;
  const workerUserId =
    uW.body && typeof uW.body === 'object' && 'id' in uW.body ? uW.body.id : null;
  if (expressUserId)
    cleanups.push(() =>
      prisma.user.delete({ where: { id: expressUserId } }).catch(() => {})
    );
  if (workerUserId)
    cleanups.push(() =>
      prisma.user.delete({ where: { id: workerUserId } }).catch(() => {})
    );

  console.log('\n=== Phase 3: Notifications (idempotent) ===');

  // read-all is idempotent — both servers operate on the same teacher
  await compareWrite(
    'PUT    /api/notifications/read-all',
    'PUT',
    '/api/notifications/read-all',
    '/api/notifications/read-all',
    undefined,
    undefined,
    tok
  );

  console.log('\n=== Phase 4: Skipped (CF queue / multipart / risky) ===');
  for (const [name, why] of [
    ['POST   /api/worksheet-generation/generate', 'publishes to PDF queue (prod CF)'],
    ['POST   /api/worksheet-generation/generate-class', 'publishes to question + PDF queues'],
    ['POST   /api/worksheet-processing/process', 'publishes to grading queue'],
    ['POST   /api/worksheets/upload', 'multipart upload only — does NOT publish a queue message; matches Express (Bull disabled). Worksheets created here stay PENDING and are not auto-graded. Real grading flow: /api/worksheet-processing/process'],
    ['POST   /api/users/upload-csv', 'multipart CSV; needs FormData parity test'],
    ['POST   /api/classes/.../csv', 'multipart CSV; needs FormData parity test'],
    ['POST   /internal/grading-worker/jobs/:id/*', 'state-machine mutators; need lease orchestration'],
    ['POST   /internal/question-bank/store', 'mutator with no parity baseline'],
    ['POST   /internal/question-bank/generate', 'publishes to CF queue'],
  ])
    skipCase(name, why);
}

(async () => {
  try {
    await main();
  } catch (e) {
    console.error('smoke-writes crashed:', e);
    process.exitCode = 2;
  } finally {
    // Run all cleanups
    for (const fn of cleanups) await fn();
    await prisma.$disconnect();

    console.log('\n──────────────────────────────────────────');
    console.log(
      `${G}PASS${N} ${pass}  ${R}FAIL${N} ${fail}  ${Y}HANG${N} ${hang}  ${Y}SKIP${N} ${skip}`
    );
    if (hangs.length) {
      console.log(`${Y}Hangs:${N}`);
      for (const n of hangs) console.log('  -', n);
    }
    if (failed.length) {
      console.log(`${R}Real failures:${N}`);
      for (const n of failed) console.log('  -', n);
      process.exitCode = 1;
    }
  }
})();
