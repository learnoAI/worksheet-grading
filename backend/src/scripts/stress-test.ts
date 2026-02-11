/**
 * Stress Test Script for Worksheet Grading API
 * 
 * Usage:
 *   npx ts-node src/scripts/stress-test.ts [options]
 * 
 * Options (via env vars):
 *   TARGET_URL     - API base URL (default: http://localhost:5100/api)
 *   TEST_USERNAME  - Login username (default: t_ayam)
 *   TEST_PASSWORD  - Login password (default: 12345678)
 *   CONCURRENT     - Number of concurrent "users" (default: 5)
 *   ITERATIONS     - Requests per user per endpoint (default: 10)
 *   MODE           - "readonly" (safe for prod) or "full" (includes writes) (default: readonly)
 *   DELAY_MS       - Delay between requests in ms (default: 100)
 * 
 * Examples:
 *   # Safe read-only test against production (5 concurrent users, 10 iterations each)
 *   TARGET_URL=https://your-deployed-api.com/api CONCURRENT=5 ITERATIONS=10 npx ts-node src/scripts/stress-test.ts
 * 
 *   # Full test against localhost (includes write operations)
 *   MODE=full CONCURRENT=10 ITERATIONS=20 npx ts-node src/scripts/stress-test.ts
 * 
 *   # Light production smoke test
 *   TARGET_URL=https://your-api.com/api CONCURRENT=2 ITERATIONS=3 npx ts-node src/scripts/stress-test.ts
 */

import fetch from 'node-fetch';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const FormData = require('form-data');
import * as fs from 'fs';
import * as path from 'path';

// ─── Configuration ───────────────────────────────────────────────────────────

const CONFIG = {
    targetUrl: process.env.TARGET_URL || 'http://localhost:5100/api',
    username: process.env.TEST_USERNAME || 't_ayam',
    password: process.env.TEST_PASSWORD || '12345678',
    concurrent: parseInt(process.env.CONCURRENT || '5', 10),
    iterations: parseInt(process.env.ITERATIONS || '10', 10),
    mode: (process.env.MODE || 'readonly') as 'readonly' | 'full',
    delayMs: parseInt(process.env.DELAY_MS || '100', 10),
    gradingConcurrent: parseInt(process.env.GRADING_CONCURRENT || '2', 10),
    gradingIterations: parseInt(process.env.GRADING_ITERATIONS || '3', 10),
};

// Load test image once into memory
const TEST_IMAGE_PATH = path.join(__dirname, 'test-fixtures', 'test-worksheet.jpg');
let testImageBuffer: Buffer | null = null;
try {
    testImageBuffer = fs.readFileSync(TEST_IMAGE_PATH);
    console.log(`  📷 Test image loaded: ${(testImageBuffer.length / 1024).toFixed(0)}KB`);
} catch {
    console.warn('  ⚠️  No test image found at test-fixtures/test-worksheet.jpg — AI grading tests will be skipped');
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface RequestResult {
    endpoint: string;
    method: string;
    status: number;
    durationMs: number;
    success: boolean;
    error?: string;
    userId: number;
}

interface EndpointStats {
    endpoint: string;
    totalRequests: number;
    successCount: number;
    failCount: number;
    avgMs: number;
    minMs: number;
    maxMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    errorsPerSecond: number;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
}

function formatMs(ms: number): string {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

function bar(value: number, max: number, width: number = 30): string {
    const filled = Math.round((value / max) * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// ─── API Client ──────────────────────────────────────────────────────────────

class StressTestClient {
    private token: string = '';
    private userId: number;
    private results: RequestResult[] = [];
    private teacherId: string = '';
    private classIds: string[] = [];
    private studentIds: string[] = [];
    private studentTokenNos: string[] = [];
    private worksheetNames: string[] = [];

    constructor(userId: number) {
        this.userId = userId;
    }

    private async request(
        endpoint: string,
        method: string = 'GET',
        body?: any,
        isFormData: boolean = false
    ): Promise<RequestResult> {
        const url = `${CONFIG.targetUrl}${endpoint}`;
        const start = performance.now();

        try {
            const headers: Record<string, string> = {
                ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
                ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
            };

            const response = await fetch(url, {
                method,
                headers,
                body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
            });

            const durationMs = performance.now() - start;
            const result: RequestResult = {
                endpoint: `${method} ${endpoint}`,
                method,
                status: response.status,
                durationMs,
                success: response.ok,
                userId: this.userId,
            };

            if (!response.ok) {
                try {
                    const errBody = await response.json();
                    result.error = (errBody as any)?.message || `HTTP ${response.status}`;
                } catch {
                    result.error = `HTTP ${response.status}`;
                }
            } else {
                // Consume body to free memory
                await response.json().catch(() => { });
            }

            this.results.push(result);
            return result;
        } catch (error: any) {
            const durationMs = performance.now() - start;
            const result: RequestResult = {
                endpoint: `${method} ${endpoint}`,
                method,
                status: 0,
                durationMs,
                success: false,
                error: error.message || 'Network error',
                userId: this.userId,
            };
            this.results.push(result);
            return result;
        }
    }

    // ─── Test Scenarios ──────────────────────────────────────────────────

    async login(): Promise<boolean> {
        const url = `${CONFIG.targetUrl}/auth/login`;
        const start = performance.now();

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: CONFIG.username,
                    password: CONFIG.password,
                }),
            });

            const durationMs = performance.now() - start;
            const data = await response.json() as any;

            this.results.push({
                endpoint: 'POST /auth/login',
                method: 'POST',
                status: response.status,
                durationMs,
                success: response.ok,
                error: response.ok ? undefined : data?.message,
                userId: this.userId,
            });

            if (response.ok && data.token) {
                this.token = data.token;
                this.teacherId = data.user?.id || '';
                return true;
            }
            return false;
        } catch (error: any) {
            this.results.push({
                endpoint: 'POST /auth/login',
                method: 'POST',
                status: 0,
                durationMs: performance.now() - start,
                success: false,
                error: error.message,
                userId: this.userId,
            });
            return false;
        }
    }

    async discoverData(): Promise<void> {
        // Get teacher's classes
        if (this.teacherId) {
            const url = `${CONFIG.targetUrl}/worksheets/teacher/${this.teacherId}/classes`;
            try {
                const response = await fetch(url, {
                    headers: { Authorization: `Bearer ${this.token}` },
                });
                if (response.ok) {
                    const classes = await response.json() as any[];
                    this.classIds = classes.map((c: any) => c.id).slice(0, 3);
                }
            } catch { }
        }

        // Get students for the first class
        if (this.classIds.length > 0) {
            const url = `${CONFIG.targetUrl}/worksheets/class/${this.classIds[0]}/students`;
            try {
                const response = await fetch(url, {
                    headers: { Authorization: `Bearer ${this.token}` },
                });
                if (response.ok) {
                    const students = await response.json() as any[];
                    this.studentIds = students.map((s: any) => s.id).slice(0, 5);
                    this.studentTokenNos = students.map((s: any) => s.tokenNumber || 'unknown').slice(0, 5);
                }
            } catch { }
        }

        // Get worksheet templates
        try {
            const url = `${CONFIG.targetUrl}/worksheets/templates`;
            const response = await fetch(url, {
                headers: { Authorization: `Bearer ${this.token}` },
            });
            if (response.ok) {
                const templates = await response.json() as any[];
                this.worksheetNames = templates.map((t: any) => t.name || `Worksheet ${t.worksheetNumber}`).slice(0, 5);
            }
        } catch { }
    }

    async runReadOnlyTests(): Promise<void> {
        const today = new Date().toISOString().split('T')[0];

        for (let i = 0; i < CONFIG.iterations; i++) {
            // Health check
            await this.request('/auth/me');

            // Get teacher classes
            if (this.teacherId) {
                await this.request(`/worksheets/teacher/${this.teacherId}/classes`);
            }

            // Get class students
            for (const classId of this.classIds.slice(0, 2)) {
                await this.request(`/worksheets/class/${classId}/students`);
            }

            // Get class worksheets for today
            for (const classId of this.classIds.slice(0, 2)) {
                await this.request(
                    `/worksheets/class-date?classId=${encodeURIComponent(classId)}&submittedOn=${encodeURIComponent(today)}`
                );
            }

            // Find worksheets for specific students
            if (this.classIds.length > 0 && this.studentIds.length > 0) {
                const startDate = new Date(today);
                const endDate = new Date(today);
                endDate.setDate(endDate.getDate() + 1);

                await this.request(
                    `/worksheets/find-all?classId=${encodeURIComponent(this.classIds[0])}&studentId=${encodeURIComponent(this.studentIds[0])}&startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`
                );
            }

            // Get worksheet history for a student
            if (this.classIds.length > 0 && this.studentIds.length > 0) {
                await this.request(
                    `/worksheets/history?classId=${this.classIds[0]}&studentId=${this.studentIds[0]}&endDate=${new Date().toISOString()}`
                );
            }

            // Grading jobs - check teacher jobs today
            await this.request('/grading-jobs/teacher/today');

            // Grading jobs by class
            if (this.classIds.length > 0) {
                await this.request(
                    `/grading-jobs/class/${this.classIds[0]}?date=${encodeURIComponent(today)}`
                );
            }

            await sleep(CONFIG.delayMs);
        }
    }

    async runWriteTests(): Promise<void> {
        if (this.classIds.length === 0 || this.studentIds.length === 0) {
            console.log(`  [User ${this.userId}] Skipping write tests - no classes/students found`);
            return;
        }

        const today = new Date().toISOString().split('T')[0];

        for (let i = 0; i < Math.min(CONFIG.iterations, 3); i++) {
            // Check if worksheet would be repeated
            await this.request('/worksheets/check-repeated', 'POST', {
                classId: this.classIds[0],
                studentId: this.studentIds[0],
                worksheetNumber: 1,
                beforeDate: new Date().toISOString(),
            });

            // Get recommended worksheet
            await this.request('/worksheets/recommend-next', 'POST', {
                classId: this.classIds[0],
                studentId: this.studentIds[0],
                beforeDate: new Date().toISOString(),
            });

            await sleep(CONFIG.delayMs * 2);
        }
    }

    async runAiGradingTests(): Promise<void> {
        if (!testImageBuffer) {
            console.log(`  [User ${this.userId}] Skipping AI grading — no test image`);
            return;
        }
        if (this.classIds.length === 0 || this.studentIds.length === 0) {
            console.log(`  [User ${this.userId}] Skipping AI grading — no classes/students found`);
            return;
        }

        const worksheetName = this.worksheetNames[0] || 'Subtraction - 1732';
        const submittedOn = new Date().toISOString();

        for (let i = 0; i < CONFIG.gradingIterations; i++) {
            // Pick a student (cycle through available students)
            const studentIdx = i % this.studentIds.length;
            const studentId = this.studentIds[studentIdx];
            const tokenNo = this.studentTokenNos[studentIdx] || 'test_token';

            // Build multipart form data with the test image
            const formData = new FormData();
            formData.append('files', testImageBuffer, {
                filename: `stress-test-${this.userId}-${i}.jpg`,
                contentType: 'image/jpeg',
            });
            formData.append('token_no', tokenNo);
            formData.append('worksheet_name', worksheetName);
            formData.append('classId', this.classIds[0]);
            formData.append('studentId', studentId);
            formData.append('worksheetNumber', '1732');
            formData.append('submittedOn', submittedOn);
            formData.append('isRepeated', 'false');

            // Send the grading request
            const url = `${CONFIG.targetUrl}/worksheet-processing/process`;
            const start = performance.now();

            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${this.token}`,
                        ...formData.getHeaders(),
                    },
                    body: formData,
                });

                const durationMs = performance.now() - start;
                let responseData: any = {};
                try { responseData = await response.json(); } catch { }

                this.results.push({
                    endpoint: 'POST /worksheet-processing/process',
                    method: 'POST',
                    status: response.status,
                    durationMs,
                    success: response.ok || response.status === 202,
                    error: response.ok || response.status === 202
                        ? undefined
                        : responseData?.error || `HTTP ${response.status}`,
                    userId: this.userId,
                });

                if (response.status === 202 && responseData?.jobId) {
                    process.stdout.write(`  🤖 User ${this.userId} grading job ${responseData.jobId} queued (${formatMs(durationMs)})\n`);
                }
            } catch (error: any) {
                this.results.push({
                    endpoint: 'POST /worksheet-processing/process',
                    method: 'POST',
                    status: 0,
                    durationMs: performance.now() - start,
                    success: false,
                    error: error.message || 'Network error',
                    userId: this.userId,
                });
            }

            // Wait between grading requests (these are expensive)
            await sleep(CONFIG.delayMs * 5);
        }
    }

    getResults(): RequestResult[] {
        return this.results;
    }
}

// ─── Report Generation ──────────────────────────────────────────────────────

function generateReport(allResults: RequestResult[], startTime: number, endTime: number): void {
    const totalDuration = (endTime - startTime) / 1000;

    console.log('\n');
    console.log('╔══════════════════════════════════════════════════════════════════════╗');
    console.log('║                    STRESS TEST RESULTS                              ║');
    console.log('╚══════════════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`  Target:       ${CONFIG.targetUrl}`);
    console.log(`  Mode:         ${CONFIG.mode}`);
    console.log(`  Concurrent:   ${CONFIG.concurrent} users`);
    console.log(`  Iterations:   ${CONFIG.iterations} per user`);
    console.log(`  Delay:        ${CONFIG.delayMs}ms between requests`);
    console.log(`  Duration:     ${totalDuration.toFixed(1)}s`);
    console.log(`  Total Reqs:   ${allResults.length}`);
    console.log(`  Throughput:   ${(allResults.length / totalDuration).toFixed(1)} req/s`);
    console.log('');

    // Group results by endpoint
    const byEndpoint = new Map<string, RequestResult[]>();
    for (const r of allResults) {
        const existing = byEndpoint.get(r.endpoint) || [];
        existing.push(r);
        byEndpoint.set(r.endpoint, existing);
    }

    // Calculate stats for each endpoint
    const stats: EndpointStats[] = [];
    for (const [endpoint, results] of Array.from(byEndpoint.entries())) {
        const durations = results.map(r => r.durationMs).sort((a, b) => a - b);
        const successCount = results.filter(r => r.success).length;
        const failCount = results.length - successCount;

        stats.push({
            endpoint,
            totalRequests: results.length,
            successCount,
            failCount,
            avgMs: durations.reduce((a, b) => a + b, 0) / durations.length,
            minMs: durations[0],
            maxMs: durations[durations.length - 1],
            p50Ms: percentile(durations, 50),
            p95Ms: percentile(durations, 95),
            p99Ms: percentile(durations, 99),
            errorsPerSecond: failCount / totalDuration,
        });
    }

    // Sort by p95 descending (slowest first)
    stats.sort((a, b) => b.p95Ms - a.p95Ms);

    // Print per-endpoint stats
    console.log('┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐');
    console.log('│  ENDPOINT PERFORMANCE                                                                              │');
    console.log('├─────────────────────────────────────────────────────────────────────────────────────────────────────┤');

    const maxP95 = Math.max(...stats.map(s => s.p95Ms), 1);

    for (const s of stats) {
        const successRate = ((s.successCount / s.totalRequests) * 100).toFixed(0);
        const statusIcon = s.failCount === 0 ? '✅' : s.failCount / s.totalRequests > 0.1 ? '🔴' : '⚠️';

        console.log(`│  ${statusIcon} ${s.endpoint.padEnd(55)}`);
        console.log(`│     Reqs: ${String(s.totalRequests).padEnd(6)} Success: ${successRate}%    Errors: ${s.failCount}`);
        console.log(`│     Avg: ${formatMs(s.avgMs).padEnd(10)} P50: ${formatMs(s.p50Ms).padEnd(10)} P95: ${formatMs(s.p95Ms).padEnd(10)} P99: ${formatMs(s.p99Ms)}`);
        console.log(`│     Min: ${formatMs(s.minMs).padEnd(10)} Max: ${formatMs(s.maxMs)}`);
        console.log(`│     ${bar(s.p95Ms, maxP95)} ${formatMs(s.p95Ms)}`);
        console.log('│');
    }

    console.log('└─────────────────────────────────────────────────────────────────────────────────────────────────────┘');

    // Summary
    const totalSuccess = allResults.filter(r => r.success).length;
    const totalFail = allResults.length - totalSuccess;
    const allDurations = allResults.map(r => r.durationMs).sort((a, b) => a - b);

    console.log('');
    console.log('┌─────────────────────────────────────────┐');
    console.log('│  SUMMARY                                │');
    console.log('├─────────────────────────────────────────┤');
    console.log(`│  Total Requests:  ${String(allResults.length).padEnd(20)} │`);
    console.log(`│  Successful:      ${String(totalSuccess).padEnd(20)} │`);
    console.log(`│  Failed:          ${String(totalFail).padEnd(20)} │`);
    console.log(`│  Success Rate:    ${((totalSuccess / allResults.length) * 100).toFixed(1).padEnd(18)}% │`);
    console.log(`│  Overall P50:     ${formatMs(percentile(allDurations, 50)).padEnd(20)} │`);
    console.log(`│  Overall P95:     ${formatMs(percentile(allDurations, 95)).padEnd(20)} │`);
    console.log(`│  Overall P99:     ${formatMs(percentile(allDurations, 99)).padEnd(20)} │`);
    console.log(`│  Throughput:      ${(allResults.length / totalDuration).toFixed(1).padEnd(16)} req/s │`);
    console.log('└─────────────────────────────────────────┘');

    // Errors breakdown
    if (totalFail > 0) {
        console.log('');
        console.log('┌─────────────────────────────────────────┐');
        console.log('│  ⚠️  ERRORS                             │');
        console.log('├─────────────────────────────────────────┤');

        const errorsByMsg = new Map<string, number>();
        for (const r of allResults.filter(r => !r.success)) {
            const msg = r.error || `HTTP ${r.status}`;
            errorsByMsg.set(msg, (errorsByMsg.get(msg) || 0) + 1);
        }

        for (const [msg, count] of Array.from(errorsByMsg.entries())) {
            console.log(`│  ${count}x  ${msg.substring(0, 35).padEnd(35)} │`);
        }

        console.log('└─────────────────────────────────────────┘');
    }

    // Memory usage
    const mem = process.memoryUsage();
    console.log('');
    console.log(`  Memory: RSS=${(mem.rss / 1024 / 1024).toFixed(1)}MB  Heap=${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB/${(mem.heapTotal / 1024 / 1024).toFixed(1)}MB`);
    console.log('');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    console.log('');
    console.log('🚀 Worksheet Grading API Stress Test');
    console.log('════════════════════════════════════════');
    console.log(`  Target:      ${CONFIG.targetUrl}`);
    console.log(`  Mode:        ${CONFIG.mode} ${CONFIG.mode === 'readonly' ? '(safe for production)' : '⚠️  (includes writes + AI grading!)'}`);
    console.log(`  Concurrent:  ${CONFIG.concurrent} simulated users`);
    console.log(`  Iterations:  ${CONFIG.iterations} per user`);
    console.log(`  Delay:       ${CONFIG.delayMs}ms between requests`);
    console.log('');

    // Step 1: Single login to validate credentials
    console.log('📋 Step 1: Validating credentials...');
    const probe = new StressTestClient(0);
    const loginOk = await probe.login();

    if (!loginOk) {
        console.error('❌ Login failed! Check credentials and target URL.');
        console.error(`   URL: ${CONFIG.targetUrl}/auth/login`);
        console.error(`   Username: ${CONFIG.username}`);
        process.exit(1);
    }
    console.log('  ✅ Login successful');

    // Step 2: Discover test data (classes, students)
    console.log('📋 Step 2: Discovering test data...');
    await probe.discoverData();
    console.log(`  ✅ Found ${probe['classIds'].length} classes, ${probe['studentIds'].length} students`);

    if (probe['classIds'].length === 0) {
        console.warn('  ⚠️  No classes found — test coverage will be limited');
    }

    // Step 3: Run concurrent stress test
    console.log(`\n🔥 Step 3: Running stress test with ${CONFIG.concurrent} concurrent users...`);
    console.log(`  Each user will make ~${CONFIG.iterations * 8} read requests + ${CONFIG.mode === 'full' ? CONFIG.gradingIterations + ' AI grading requests' : '0 write requests'}`);
    console.log('');

    const startTime = performance.now();

    // Create concurrent clients
    const clients = Array.from({ length: CONFIG.concurrent }, (_, i) => {
        const client = new StressTestClient(i + 1);
        // Share discovered data so we don't need to discover per-client
        (client as any).teacherId = probe['teacherId'];
        (client as any).classIds = [...probe['classIds']];
        (client as any).studentIds = [...probe['studentIds']];
        return client;
    });

    // Run all clients concurrently
    const tasks = clients.map(async (client, idx) => {
        // Stagger start times slightly to avoid thundering herd
        await sleep(idx * 50);

        // Login (each user gets their own token)
        const ok = await client.login();
        if (!ok) {
            console.error(`  ❌ User ${idx + 1} login failed — skipping`);
            return;
        }

        process.stdout.write(`  ▶ User ${idx + 1} started\n`);

        // Read-only tests (always run)
        await client.runReadOnlyTests();

        // Write tests (only in "full" mode)
        if (CONFIG.mode === 'full') {
            await client.runWriteTests();
        }

        // AI grading tests (only in "full" mode)
        if (CONFIG.mode === 'full') {
            await client.runAiGradingTests();
        }

        process.stdout.write(`  ✅ User ${idx + 1} completed\n`);
    });

    await Promise.all(tasks);
    const endTime = performance.now();

    // Collect all results
    const allResults = clients.flatMap(c => c.getResults());

    // Add probe results too
    allResults.push(...probe.getResults());

    // Generate report
    generateReport(allResults, startTime, endTime);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
