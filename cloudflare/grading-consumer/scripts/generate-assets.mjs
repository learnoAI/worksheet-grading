#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function arg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

const bookJsonPath = arg('--book-json');
const promptsDir = arg('--prompts-dir');
const outDir = arg('--out-dir') || path.resolve('assets-out');

if (!bookJsonPath) {
  console.error('Missing --book-json <path/to/book_worksheets.json>');
  process.exit(1);
}

if (!promptsDir) {
  console.error('Missing --prompts-dir <path/to/prompts>');
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

for (const name of fs.readdirSync(promptsDir)) {
  if (!name.endsWith('.txt')) continue;
  fs.copyFileSync(path.join(promptsDir, name), path.join(outPromptsDir, name));
}

console.log(`Wrote ${Object.keys(answersByWorksheet).length} worksheets to ${path.join(outDir, 'answers_by_worksheet.json')}`);
console.log(`Copied prompts to ${outPromptsDir}`);

