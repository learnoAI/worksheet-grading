# Grading Pipeline Refactor + Model Benchmark Design

This document describes two related changes to the worksheet grading system:

1. **Flow 1 — Production refactor**: Merge the two-step (OCR → Grade) Gemini pipeline into a single multimodal call, so different models (Gemma 4, Claude, GPT-4o, etc.) can be swapped in cleanly.
2. **Flow 2 — Benchmark tooling**: A separate CLI for comparing multiple models against a ground-truth dataset.

---

## Table of contents

- [Flow 1: Single-call production grading](#flow-1-single-call-production-grading)
- [Flow 2: Benchmark tooling](#flow-2-benchmark-tooling)
- [Shared components](#shared-components)
- [File structure](#file-structure)
- [Design decisions to confirm](#design-decisions-to-confirm)
- [Implementation roadmap](#implementation-roadmap)

---

## Flow 1: Single-call production grading

### Current flow (2 calls)

```
Image → [OCR Model] → ExtractedQuestions → [Grading Model] → GradingResult
```

Two sequential Gemini calls per worksheet:

1. **OCR call** — extracts student answers from image
2. **Grading call** — compares extracted answers against the answer key

### Proposed flow (1 call)

```
Image + Answer Key → [Single Multimodal Model] → GradingResult
```

One call per worksheet. The model reads the image, extracts answers, and grades
them in a single step.

### Full production pipeline with single-call refactor

```
┌────────────────────────────────────────────────────────────────┐
│                      PRODUCTION FLOW                          │
└────────────────────────────────────────────────────────────────┘

Student uploads worksheet
    ↓
Backend creates GradingJob + uploads images to R2
    ↓
Cloudflare Queue: grading-fast
    ↓
Worker (grading-consumer)
    ├─ Acquire lease
    ├─ Download images from R2 (IMAGES_BUCKET)
    ├─ Load answer key from R2 (ASSETS_BUCKET)
    │
    ├─ SINGLE MODEL CALL:
    │   Input:
    │     - Image parts (inline base64)
    │     - Answer key (if book mode)
    │     - Expected question count (from answer key)
    │     - Prompt: "Extract student answers from image AND grade them"
    │   Output: GradingResult JSON
    │
    ├─ Compute final grade (correct/total * 40)
    └─ POST complete → backend
            ↓
        DB: Worksheet.grade, gradingDetails
```

### Benefits

- **~50% fewer API calls** → lower latency and cost
- **Single source of truth** — no drift between "extracted answers" and "graded answers"
- **Simpler retries** — one call to re-run instead of two
- **Model swapping is trivial** — any multimodal model that can return structured JSON works
- **Supports smaller/open models** — Gemma 4, LLaVA, InternVL, etc. via the same interface

### Risks / trade-offs

- **Harder prompt** — the model has to do more in one call, which may hurt accuracy on weaker models
- **Loss of OCR-only debug data** — we currently log `extractedQuestions.questions.length`. We'd lose that unless we ask the model to return extracted answers as part of the grading result (which we already do via `student_answer` in `QuestionScore`)
- **Custom prompt overrides** — `prompts/{worksheetNumber}.txt` in R2 currently overrides OCR. Needs a migration plan (keep as grading prompt overrides, or deprecate)

### Key change in `processJob()`

**Before** (`cloudflare/grading-consumer/src/index.ts:229-283`):

```typescript
const extracted = await geminiGenerateJson<ExtractedQuestions>({...});
const extractedQuestions = ExtractedQuestionsSchema.parse(extracted.parsed);

const answerKey = await loadAnswerKey(env.ASSETS_BUCKET);
const answers = answerKey[String(job.worksheetNumber)];

const gradingPrompt = Array.isArray(answers) && answers.length > 0
  ? buildBookGradingPrompt(extractedQuestions, answers)
  : buildAiGradingPrompt(extractedQuestions);

const grading = await geminiGenerateJson<GradingResult>({...});
```

**After**:

```typescript
const answerKey = await loadAnswerKey(env.ASSETS_BUCKET);
const answers = answerKey[String(job.worksheetNumber)];

const prompt = buildSingleCallPrompt({
  mode: Array.isArray(answers) && answers.length > 0 ? 'book' : 'ai',
  answerKey: answers,
  expectedQuestionCount: answers?.length,
});

const grading = await modelAdapter.grade({
  parts: [{ text: prompt }, ...imageParts],
  responseJsonSchema: GradingResultJsonSchema,
  temperature: 0.1,
});
```

---

## Flow 2: Benchmark tooling

### Purpose

Compare multiple models side-by-side on the **same test data** to answer:

- Which model is most accurate?
- Which is fastest?
- Which is cheapest per grade?
- Which handles tricky layouts (fractions, remainders, mixed numbers) best?
- Does the production model need to change?

### High-level flow

```
┌────────────────────────────────────────────────────────────────┐
│                      BENCHMARK FLOW                            │
└────────────────────────────────────────────────────────────────┘

GROUND TRUTH DATASET
    ├─ benchmarks/datasets/golden-set.json
    │   [{ worksheetNumber, imageUrls, expectedGrade,
    │      expectedPerQuestion: [{correct: true, ...}, ...] }]
    ├─ Source 1: Manually curated test cases (5-10 per layout type)
    ├─ Source 2: High-confidence real submissions (teacher-verified)
    └─ Answer keys: same answers_by_worksheet.json from R2
    ↓

┌────────────── BENCHMARK RUNNER (CLI, runs locally) ───────────┐
│                                                                │
│   For each MODEL in config.models:                             │
│       For each TEST_CASE in dataset:                           │
│           ┌─────────────────────────────────────┐              │
│           │   ModelAdapter.grade(               │              │
│           │     images: test.images,            │              │
│           │     answerKey: test.answers,        │              │
│           │     worksheetNumber: test.ws        │              │
│           │   )                                 │              │
│           └─────────────────────────────────────┘              │
│                         ↓                                      │
│           Record: result, latencyMs, tokens, cost              │
│                         ↓                                      │
│           Evaluator.compare(result, test.expected)             │
│                         ↓                                      │
│           Metrics: correct_grade, per_q_accuracy,              │
│                    false_pos, false_neg, parse_errors          │
│                                                                │
└────────────────────────────────────────────────────────────────┘
    ↓
REPORT GENERATION
    ├─ benchmarks/results/{timestamp}/summary.md
    ├─ benchmarks/results/{timestamp}/detailed.json
    ├─ benchmarks/results/{timestamp}/comparison.html
    │
    └─ Comparison table:
       | Model              | Grade Acc | Per-Q Acc | p50 Lat | $/grade |
       |--------------------|-----------|-----------|---------|---------|
       | gemini-2.0-flash   | 94%       | 97%       | 3.2s    | $0.002  |
       | gemma-3-27b-it     | 89%       | 94%       | 5.1s    | $0.001  |
       | claude-sonnet-4.6  | 97%       | 98%       | 4.5s    | $0.015  |
       | gpt-4o             | 95%       | 96%       | 2.8s    | $0.010  |
       | ollama/llava-34b   | 72%       | 81%       | 15s     | free    |
```

### Why a separate flow

- **Batch processing, not queue-driven** — benchmark runs linearly, not from Cloudflare Queue
- **Iterates over multiple models** — one test case is graded by every model
- **Needs ground truth** — compares output to known-correct answers
- **Reports metrics, not writes to DB** — no `GradingJob` / `Worksheet` records
- **Runs locally** — no Cloudflare Worker CPU limits; can use slow local models via Ollama
- **No heartbeat/lease/retry logic** — plain sequential loop

### Execution environment

**Recommended: Local CLI** — `node benchmarks/cli.ts run --models=gemini,claude,gemma`

- Fast iteration
- No cloud costs for orchestration
- Easy to add new models without worker redeploys
- Can use local GPU models via Ollama

### Ground-truth dataset

A `golden-set.json` file with a small number of hand-verified test cases:

```json
[
  {
    "id": "test-001",
    "worksheetNumber": 353,
    "layout": "B",
    "description": "40-question grid, all correct",
    "imageFiles": ["images/test-001-page1.png"],
    "expectedGrade": 40,
    "expectedPerQuestion": [
      {"q": 1, "studentAnswer": "32", "correct": true},
      {"q": 2, "studentAnswer": "33", "correct": true},
      ...
    ]
  },
  {
    "id": "test-002",
    "worksheetNumber": 2287,
    "layout": "B (fraction)",
    "description": "Mixed-number fractions, half wrong",
    "imageFiles": ["images/test-002-page1.png"],
    "expectedGrade": 20,
    "expectedPerQuestion": [...]
  }
]
```

**Coverage targets**:

- At least 3 Layout A worksheets (comma-separated lists)
- At least 3 Layout B standard (single-value grid)
- At least 3 Layout C (2-column grid)
- At least 3 Fraction worksheets (proper fractions + mixed numbers)
- At least 2 Remainder worksheets
- At least 2 Expanded-form worksheets
- At least 2 Edge cases (negative numbers, equivalent fractions, etc.)
- Mix of all-correct, all-wrong, and partial-correct student submissions

Total: ~20 curated cases is enough to start.

---

## Shared components

These are reused by both flows (refactor once, use in both places).

### 1. Single-call prompt builder

`cloudflare/grading-consumer/src/prompts.ts`

```typescript
export function buildSingleCallPrompt(opts: {
  mode: 'book' | 'ai';
  answerKey?: string[];
  expectedQuestionCount?: number;
}): string {
  const { mode, answerKey, expectedQuestionCount } = opts;

  const rules = `<Rules>
1. Extract every student answer from the worksheet image(s) exactly as written.
2. If a question is unanswered, record an empty string "" as the student_answer.
3. No partial grading — each question is either fully correct or worth 0 points.
4. Use evenly distributed max_points so total = 40 (platform computes final score).
5. Return results in question-number order.
</Rules>`;

  if (mode === 'book' && answerKey) {
    const answerList = answerKey
      .map((a, i) => `Q${i + 1}: ${a}`)
      .join('\n');

    return `You are an expert teacher grading a worksheet.
Below is the correct answer key. Read the student's worksheet from the image(s),
extract their answers, compare each to the correct answer, and return a grading result.

${rules}

<AnswerKey>
Total questions: ${expectedQuestionCount}
${answerList}
</AnswerKey>

Return JSON matching the provided schema.`;
  }

  // AI mode — no answer key
  return `You are an expert teacher grading a worksheet. No answer key is provided;
you must judge correctness based on your own mathematical knowledge.

${rules}

Return JSON matching the provided schema.`;
}
```

### 2. Model adapter interface

`cloudflare/grading-consumer/src/modelAdapter.ts`

```typescript
export interface GradingInput {
  parts: Array<
    | { text: string }
    | { inline_data: { mime_type: string; data: string } }
  >;
  responseJsonSchema?: unknown;
  temperature?: number;
}

export interface GradingOutput {
  parsed: GradingResult;
  rawText: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface ModelAdapter {
  readonly name: string;      // "gemini-2.0-flash"
  readonly provider: string;  // "gemini"

  grade(input: GradingInput): Promise<GradingOutput>;
}
```

Implementations:

- **GeminiAdapter** — wraps existing `geminiGenerateJson()`, used in production + benchmarks
- **GemmaAdapter** — via Vertex AI or HuggingFace Inference, benchmarks only
- **ClaudeAdapter** — via Anthropic SDK, benchmarks only
- **OpenAIAdapter** — via OpenAI SDK, benchmarks only
- **OllamaAdapter** — local HTTP to `http://localhost:11434`, benchmarks only

Each adapter handles:

- Input format conversion (image → base64 / URL / multipart)
- API authentication
- Response parsing
- Token counting
- Cost calculation (per-provider pricing)

---

## File structure

```
cloudflare/grading-consumer/src/
  ├── prompts.ts              # ADD buildSingleCallPrompt(); keep old builders for rollback
  ├── gemini.ts               # Existing, unchanged
  ├── modelAdapter.ts         # NEW — abstract ModelAdapter interface
  ├── adapters/
  │   ├── base.ts             # Re-exports ModelAdapter
  │   └── gemini.ts           # GeminiAdapter wraps geminiGenerateJson()
  └── index.ts                # REFACTOR processJob() to use single call + adapter

benchmarks/                    # NEW top-level directory
  ├── README.md
  ├── package.json
  ├── tsconfig.json
  ├── src/
  │   ├── cli.ts              # node benchmarks/cli.ts run --models=a,b,c
  │   ├── datasetLoader.ts    # Load golden-set.json + images into memory
  │   ├── runner.ts           # Orchestrate runs across models & test cases
  │   ├── evaluator.ts        # Compare model output vs ground truth
  │   ├── reporter.ts         # Write summary.md, detailed.json, HTML
  │   └── adapters/
  │       ├── base.ts         # Re-exported ModelAdapter interface
  │       ├── gemini.ts       # Wraps worker's GeminiAdapter
  │       ├── gemma.ts        # Vertex AI or HuggingFace
  │       ├── claude.ts       # Anthropic SDK
  │       ├── openai.ts       # OpenAI SDK
  │       └── ollama.ts       # Local HTTP to Ollama
  ├── datasets/
  │   ├── golden-set-v1.json  # Manually curated test cases
  │   └── images/             # Referenced image files
  └── results/
      └── .gitkeep
```

---

## Metrics to compute

### Per-run metrics

| Metric                  | Definition                                                        |
| ----------------------- | ----------------------------------------------------------------- |
| **Grade accuracy**      | `% of test cases where model's final grade matches ground truth` |
| **Per-question accuracy** | `% of individual question judgments that matched ground truth`  |
| **False positives**     | `Marked wrong answer as correct (overscoring)`                    |
| **False negatives**     | `Marked correct answer as wrong (underscoring)`                   |
| **Extraction accuracy** | `% of student answers extracted matching expected`                |
| **JSON parse errors**   | `Count of responses that failed schema validation`                |
| **Latency p50/p95/p99** | `Distribution of request durations`                               |
| **Cost per grade**      | `(input_tokens * in_price + output_tokens * out_price)`           |
| **Total cost**          | `Sum across all test cases`                                       |

### Report format

**`summary.md`** — human-readable comparison:

```markdown
# Benchmark Run: 2026-04-10_14-30-00

## Dataset
- golden-set-v1.json
- 20 test cases

## Results

| Model              | Grade Acc | Per-Q Acc | p50 Lat | p95 Lat | Cost  |
|--------------------|-----------|-----------|---------|---------|-------|
| gemini-2.0-flash   | 94.5%     | 97.1%     | 3.2s    | 5.8s    | $0.04 |
| gemma-3-27b-it     | 89.0%     | 94.2%     | 5.1s    | 8.9s    | $0.02 |
| claude-sonnet-4.6  | 97.0%     | 98.3%     | 4.5s    | 7.2s    | $0.30 |
| gpt-4o             | 95.5%     | 96.5%     | 2.8s    | 4.9s    | $0.20 |

## Failure cases (where models disagreed)

### Test case: test-007 (WS 2287, fraction layout)
- Expected grade: 35/40
- gemini-2.0-flash: 37 ❌
- gemma-3-27b-it: 30 ❌
- claude-sonnet-4.6: 35 ✓
- gpt-4o: 34 ❌

Detailed per-question comparison at: results/2026-04-10_14-30-00/test-007.json
```

**`detailed.json`** — full machine-readable results for each test case per model
**`comparison.html`** — visual diff (optional, nice-to-have)

---

## Design decisions to confirm

### 1. Ground truth source for benchmarks

| Option | Pros | Cons |
| ------ | ---- | ---- |
| **A. Manually curated dataset** | Known correct, covers edge cases | Manual effort upfront |
| **B. High-confidence prod grading jobs** | Real data, no curation | "Correct" = whatever old pipeline produced, may be wrong |
| **C. Both (A + B)** | Start small with A, expand with B | More work but robust |

**Recommendation**: Start with **A** (20 curated cases), add **B** later for scale.

### 2. Benchmark execution environment

| Option | Pros | Cons |
| ------ | ---- | ---- |
| **A. Local CLI** | Fast, cheap, easy to iterate, can use local models | Not production-identical |
| **B. Cloudflare Worker + dedicated queue** | Mirrors prod exactly | Complex, slow to iterate, cloud costs |

**Recommendation**: **A** (Local CLI).

### 3. What to benchmark

Priority order:

1. **Final grade correctness** (most important)
2. **Per-question correctness**
3. **JSON parse reliability**
4. **Latency (p50/p95)**
5. **Cost per grade**
6. **Extraction accuracy** (the answers the model pulled from the image)
7. *Optional*: Confidence calibration, refusal rate, hallucination rate

### 4. Environment variable naming

Current env vars are Gemini-specific:

- `GEMINI_API_KEY`
- `GEMINI_OCR_MODEL`
- `GEMINI_BOOK_GRADING_MODEL`
- `GEMINI_AI_GRADING_MODEL`

Proposed generic names:

- `GRADING_MODEL_PROVIDER` (= `gemini` / `claude` / `openai` / etc.)
- `GRADING_MODEL_NAME` (= `gemini-2.0-flash` / `claude-sonnet-4-6` / etc.)
- `GRADING_MODEL_API_KEY` (provider-specific secret)

Keep backward compatibility: if `GRADING_MODEL_PROVIDER` is unset, fall back to
existing `GEMINI_*` env vars.

### 5. Custom prompt overrides (`prompts/{worksheetNumber}.txt` in R2)

Currently used to override OCR prompt for specific worksheets. In single-call
mode this no longer makes sense as-is. Options:

| Option | Effect |
| ------ | ------ |
| **Keep, repurpose as grading prompt overrides** | Allows fine-tuning specific worksheets |
| **Deprecate and delete** | Simpler; rely on answer key for correctness |
| **Keep but rename path** (e.g. `grading-prompts/{N}.txt`) | Clear separation |

**Recommendation**: Deprecate. The single-call prompt with the answer key should
be sufficient. If specific worksheets misbehave, fix them via the answer key or
a targeted prompt override added later.

### 6. Should AI mode be kept?

Currently, worksheets without an entry in `answers_by_worksheet.json` fall back
to AI mode (model grades without an answer key).

- **Keep**: Graceful degradation for new worksheets not yet in the JSON
- **Remove**: Fail loudly so we always know when a worksheet is missing

**Recommendation**: Keep AI mode but emit a PostHog event when it's used, so we
can track and fix missing answer keys.

---

## Implementation roadmap

### Phase A — Production refactor (single-call)

1. Add `buildSingleCallPrompt()` to `prompts.ts` (keep old builders for rollback)
2. Create `modelAdapter.ts` interface + `adapters/gemini.ts`
3. Refactor `processJob()` in `index.ts`:
   - Drop OCR call
   - Use `ModelAdapter.grade()` with single prompt + image parts
4. Update env vars: add `GRADING_MODEL_NAME`, keep `GEMINI_*` as fallback
5. Add unit tests for the new prompt builder
6. Deploy to staging worker
7. Grade 5-10 known-good worksheets in staging and compare against current prod
8. If good → promote to prod worker
9. Monitor for regression via PostHog events + `wrangler tail`

### Phase B — Benchmark scaffolding

1. Create `benchmarks/` directory structure
2. Write `datasetLoader.ts` and ship `golden-set-v1.json` with 5 test cases
3. Reuse `ModelAdapter` from worker + add local-only adapters:
   - `adapters/gemini.ts` (works immediately)
4. Write `runner.ts` that runs one model over the dataset
5. Write `evaluator.ts` (grade-match + per-question match)
6. Write `reporter.ts` (markdown summary + JSON detailed)
7. Wire up CLI: `node benchmarks/cli.ts run --models=gemini-2.0-flash`
8. Run it locally and verify output format

### Phase C — Expand benchmark coverage

1. Add remaining model adapters:
   - `adapters/claude.ts`
   - `adapters/openai.ts`
   - `adapters/gemma.ts` (via Vertex AI or HuggingFace)
   - `adapters/ollama.ts` (local models)
2. Expand `golden-set-v1.json` to ~20 test cases covering all layouts
3. Optional: add `golden-set-v2.json` with real prod submissions
4. Run comparison and pick the best model for each workload
5. If a better model is found, update production to use it via
   `GRADING_MODEL_NAME` env var

### Phase D — Ongoing

- Add new test cases to the golden set whenever a grading bug is found
- Re-run benchmark when new models are released (Gemma 4, Claude 5, etc.)
- Use benchmark results to inform model selection for cost/accuracy tradeoffs

---

## Summary

| Aspect            | Production Flow                  | Benchmark Flow                          |
| ----------------- | -------------------------------- | --------------------------------------- |
| **Runs on**       | Cloudflare Worker                | Local Node.js CLI                       |
| **Trigger**       | Queue message from backend       | `node benchmarks/cli.ts run` manually   |
| **Input**         | 1 worksheet per job              | 20+ test cases, multiple models         |
| **Models used**   | 1 (configured via env)           | N (parallel comparison)                 |
| **Ground truth**  | None — it IS the ground truth    | Pre-curated `golden-set.json`           |
| **Output**        | DB writes (GradingJob, Worksheet)| Markdown/JSON report files              |
| **Purpose**       | Grade student submissions        | Pick the best model for production      |
| **Shared code**   | `buildSingleCallPrompt`, `ModelAdapter`, `GeminiAdapter` | Same |

Both flows share the same prompt builder and adapter interface, so improvements
in one automatically benefit the other. The benchmark flow is the "test bench"
for the production flow.
