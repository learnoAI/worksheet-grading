#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function arg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

const bookJsonPath = arg('--book-json');
const outDir = arg('--out-dir') || path.resolve('assets-out');
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const promptsDir = arg('--prompts-dir') || path.resolve(scriptDir, '../../../prompts');

if (!bookJsonPath) {
  console.error('Missing --book-json <path/to/book_worksheets.json>');
  process.exit(1);
}

if (!fs.existsSync(promptsDir) || !fs.statSync(promptsDir).isDirectory()) {
  console.error(`Prompt directory not found: ${promptsDir}`);
  console.error('Pass --prompts-dir <path/to/prompts> if your prompts are elsewhere.');
  process.exit(1);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const data = readJson(bookJsonPath);
const books = data?.books || {};

/** @type {Record<string, string[]>} */
const answersByWorksheet = {};

for (const bookId of Object.keys(books)) {
  const worksheets = books[bookId]?.worksheets || {};
  for (const worksheetNumber of Object.keys(worksheets)) {
    if (answersByWorksheet[worksheetNumber]) continue;
    const answers = worksheets[worksheetNumber];
    if (Array.isArray(answers) && answers.length > 0) {
      answersByWorksheet[worksheetNumber] = answers;
    }
  }
}

ensureDir(outDir);
fs.writeFileSync(
  path.join(outDir, 'answers_by_worksheet.json'),
  JSON.stringify(answersByWorksheet),
  'utf8'
);

const outPromptsDir = path.join(outDir, 'prompts');
ensureDir(outPromptsDir);

const promptFiles = fs
  .readdirSync(promptsDir)
  .filter((name) => /^\d+\.txt$/.test(name))
  .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));

for (const name of promptFiles) {
  fs.copyFileSync(path.join(promptsDir, name), path.join(outPromptsDir, name));
}

console.log(`Wrote ${Object.keys(answersByWorksheet).length} worksheets to ${path.join(outDir, 'answers_by_worksheet.json')}`);
console.log(`Copied ${promptFiles.length} prompts from ${promptsDir} to ${outPromptsDir}`);
