const ANSWER_KEY_OBJECT = 'answers_by_worksheet.json';
const PROMPT_PREFIX = 'prompts/';

type AnswerKeyMap = Record<string, string[]>;

let answerKeyCache: { loadedAt: number; data: AnswerKeyMap } | null = null;
const promptCache = new Map<string, { loadedAt: number; text: string | null }>();

const ANSWER_KEY_TTL_MS = 60 * 60 * 1000; // 1 hour
const PROMPT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const PROMPT_CACHE_MAX = 500;

function prunePromptCache(): void {
  if (promptCache.size <= PROMPT_CACHE_MAX) return;

  // Drop oldest ~half.
  const entries = Array.from(promptCache.entries()).sort((a, b) => a[1].loadedAt - b[1].loadedAt);
  const toDelete = Math.ceil(entries.length / 2);
  for (let i = 0; i < toDelete; i++) {
    promptCache.delete(entries[i]![0]);
  }
}

export async function loadAnswerKey(bucket: R2Bucket): Promise<AnswerKeyMap> {
  const now = Date.now();

  if (answerKeyCache && now - answerKeyCache.loadedAt < ANSWER_KEY_TTL_MS) {
    return answerKeyCache.data;
  }

  const obj = await bucket.get(ANSWER_KEY_OBJECT);
  if (!obj) {
    throw new Error(`Missing assets object: ${ANSWER_KEY_OBJECT}`);
  }

  const text = await obj.text();
  const data = JSON.parse(text) as AnswerKeyMap;
  answerKeyCache = { loadedAt: now, data };
  return data;
}

export async function loadCustomPrompt(bucket: R2Bucket, worksheetNumber: number): Promise<string | null> {
  const key = `${worksheetNumber}`;
  const now = Date.now();
  const cached = promptCache.get(key);

  if (cached && now - cached.loadedAt < PROMPT_TTL_MS) {
    return cached.text;
  }

  const obj = await bucket.get(`${PROMPT_PREFIX}${worksheetNumber}.txt`);
  const text = obj ? await obj.text() : null;
  promptCache.set(key, { loadedAt: now, text });
  prunePromptCache();
  return text;
}

