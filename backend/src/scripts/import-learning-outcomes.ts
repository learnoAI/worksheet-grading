import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { PrismaClient, WorksheetSkillMap } from '@prisma/client';

const prisma = new PrismaClient();

const LOG_PREFIX = '[import-learning-outcomes]';

interface CurriculumRow {
  sourceRowNumber: number;
  worksheetNumber: number;
  mainTopic: string;
  learningOutcome: string;
  isTest: boolean;
  usedMainTopicAsLearningOutcome: boolean;
}

interface ParseWorkbookStats {
  dataRowsInSheet: number;
  parsedRows: number;
  skippedRows: number;
  fallbackLearningOutcomeRows: number;
  skippedMissingWorksheetNumber: number;
  skippedMissingMainTopic: number;
  skippedMissingBothWorksheetAndTopic: number;
}

interface ParseWorkbookResult {
  rows: CurriculumRow[];
  stats: ParseWorkbookStats;
}

interface SkippedRowLog {
  sourceRowNumber: number;
  worksheetNumberRaw: unknown;
  mainTopicRaw: unknown;
  learningOutcomeRaw: unknown;
  reason: string;
}

interface ImportStats {
  topicsCreated: number;
  skillsCreated: number;
  skillsScopedFromLegacy: number;
  mappingsCreated: number;
  mappingsUpdated: number;
  mappingsUnchanged: number;
}

const log = (message: string, payload?: unknown): void => {
  if (payload === undefined) {
    console.log(`${LOG_PREFIX} ${message}`);
    return;
  }

  console.log(`${LOG_PREFIX} ${message}`, payload);
};

const normalizeText = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
};

const parseWorksheetNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const parsed = parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
};

const parseIsTest = (value: unknown): boolean => {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'number') {
    return value === 1;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'test'].includes(normalized);
};

const resolveWorkbookPath = (argPath?: string): string => {
  const candidates = [
    argPath ? path.resolve(process.cwd(), argPath) : null,
    path.resolve(process.cwd(), 'learning-outcomes.xlsx'),
    path.resolve(process.cwd(), '../learning-outcomes.xlsx'),
    path.resolve(__dirname, '../../../learning-outcomes.xlsx')
  ].filter((candidate): candidate is string => !!candidate);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('Could not find learning-outcomes.xlsx. Pass a path as first argument.');
};

const parseWorkbook = (workbookPath: string): ParseWorkbookResult => {
  const workbook = XLSX.readFile(workbookPath);
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw new Error('Workbook does not contain any sheets.');
  }

  const firstSheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(firstSheet, {
    header: 1,
    raw: true,
    defval: null
  });

  if (rows.length < 2) {
    throw new Error('Workbook does not contain data rows.');
  }

  const headers = rows[0].map((cell) => normalizeText(cell)?.toLowerCase() ?? '');
  const findHeaderIndex = (candidates: string[]): number => headers.findIndex((header) => candidates.includes(header));

  const worksheetNumberIdx = findHeaderIndex(['worksheet no.', 'worksheet no', 'worksheet number']);
  const mainTopicIdx = findHeaderIndex(['main topic']);
  const learningOutcomeIdx = findHeaderIndex(['learning outcome', 'learning outcome(s)']);
  const isTestIdx = findHeaderIndex(['is_test', 'is test']);

  if (worksheetNumberIdx < 0 || mainTopicIdx < 0 || learningOutcomeIdx < 0) {
    throw new Error('Missing required columns. Expected Worksheet no., Main Topic, Learning outcome.');
  }

  log('Header mapping detected', {
    sheet: firstSheetName,
    worksheetNumberColumn: worksheetNumberIdx + 1,
    mainTopicColumn: mainTopicIdx + 1,
    learningOutcomeColumn: learningOutcomeIdx + 1,
    isTestColumn: isTestIdx >= 0 ? isTestIdx + 1 : null
  });

  const parsedRows: CurriculumRow[] = [];
  const seenWorksheetNumbers = new Set<number>();
  const skippedRowsSample: SkippedRowLog[] = [];
  const fallbackRowsSample: Array<{ sourceRowNumber: number; worksheetNumber: number; mainTopic: string }> = [];

  const stats: ParseWorkbookStats = {
    dataRowsInSheet: rows.length - 1,
    parsedRows: 0,
    skippedRows: 0,
    fallbackLearningOutcomeRows: 0,
    skippedMissingWorksheetNumber: 0,
    skippedMissingMainTopic: 0,
    skippedMissingBothWorksheetAndTopic: 0
  };

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const sourceRowNumber = i + 1;

    const worksheetNumberRaw = row[worksheetNumberIdx];
    const mainTopicRaw = row[mainTopicIdx];
    const learningOutcomeRaw = row[learningOutcomeIdx];

    const worksheetNumber = parseWorksheetNumber(worksheetNumberRaw);
    const mainTopic = normalizeText(mainTopicRaw);

    let learningOutcome = normalizeText(learningOutcomeRaw);
    let usedFallback = false;

    if (!learningOutcome && mainTopic) {
      learningOutcome = mainTopic;
      usedFallback = true;
      stats.fallbackLearningOutcomeRows++;

      if (fallbackRowsSample.length < 20 && worksheetNumber !== null) {
        fallbackRowsSample.push({
          sourceRowNumber,
          worksheetNumber,
          mainTopic
        });
      }
    }

    if (worksheetNumber === null || !mainTopic || !learningOutcome) {
      stats.skippedRows++;

      let reason = 'unknown';
      if (worksheetNumber === null && !mainTopic) {
        stats.skippedMissingBothWorksheetAndTopic++;
        reason = 'missing worksheet number and main topic';
      } else if (worksheetNumber === null) {
        stats.skippedMissingWorksheetNumber++;
        reason = 'missing worksheet number';
      } else if (!mainTopic) {
        stats.skippedMissingMainTopic++;
        reason = 'missing main topic';
      }

      if (skippedRowsSample.length < 20) {
        skippedRowsSample.push({
          sourceRowNumber,
          worksheetNumberRaw,
          mainTopicRaw,
          learningOutcomeRaw,
          reason
        });
      }

      continue;
    }

    if (seenWorksheetNumbers.has(worksheetNumber)) {
      throw new Error(`Duplicate worksheet number ${worksheetNumber} in row ${sourceRowNumber}.`);
    }

    parsedRows.push({
      sourceRowNumber,
      worksheetNumber,
      mainTopic,
      learningOutcome,
      isTest: isTestIdx >= 0 ? parseIsTest(row[isTestIdx]) : false,
      usedMainTopicAsLearningOutcome: usedFallback
    });

    seenWorksheetNumbers.add(worksheetNumber);
  }

  stats.parsedRows = parsedRows.length;

  log('Workbook parse summary', stats);

  if (fallbackRowsSample.length > 0) {
    log('Rows where Learning outcome was missing and fallback to Main Topic was applied (sample)', fallbackRowsSample);
  }

  if (skippedRowsSample.length > 0) {
    log('Skipped rows (sample)', skippedRowsSample);
  }

  return { rows: parsedRows, stats };
};

const skillKey = (mainTopicId: string, learningOutcome: string): string => `${mainTopicId}::${learningOutcome}`;

const importCurriculum = async (rows: CurriculumRow[]): Promise<ImportStats> => {
  log('Fetching existing topics, skills, and worksheet mappings from database...');

  const existingTopics = await prisma.mainTopic.findMany({
    select: { id: true, name: true }
  });
  const topicIdByName = new Map<string, string>(existingTopics.map((topic) => [topic.name, topic.id] as const));

  const existingSkills = await prisma.mathSkill.findMany({
    select: { id: true, name: true, mainTopicId: true }
  });

  const skillIdByKey = new Map<string, string>();
  const unscopedSkillIdsByName = new Map<string, string[]>();

  for (const skill of existingSkills) {
    if (skill.mainTopicId) {
      skillIdByKey.set(skillKey(skill.mainTopicId, skill.name), skill.id);
      continue;
    }

    const bucket = unscopedSkillIdsByName.get(skill.name) ?? [];
    bucket.push(skill.id);
    unscopedSkillIdsByName.set(skill.name, bucket);
  }

  const existingMappings = await prisma.worksheetSkillMap.findMany();

  const mappingByWorksheetNumber = new Map<number, WorksheetSkillMap>(
    existingMappings.map((mapping) => [mapping.worksheetNumber, mapping])
  );

  log('Existing records loaded', {
    existingTopics: existingTopics.length,
    existingSkills: existingSkills.length,
    existingMappings: existingMappings.length
  });

  const stats: ImportStats = {
    topicsCreated: 0,
    skillsCreated: 0,
    skillsScopedFromLegacy: 0,
    mappingsCreated: 0,
    mappingsUpdated: 0,
    mappingsUnchanged: 0
  };

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];

    let mainTopicId = topicIdByName.get(row.mainTopic);
    if (!mainTopicId) {
      const createdTopic = await prisma.mainTopic.create({
        data: { name: row.mainTopic },
        select: { id: true }
      });
      mainTopicId = createdTopic.id;
      topicIdByName.set(row.mainTopic, mainTopicId);
      stats.topicsCreated++;
    }

    const currentSkillKey = skillKey(mainTopicId, row.learningOutcome);
    let learningOutcomeSkillId = skillIdByKey.get(currentSkillKey);

    if (!learningOutcomeSkillId) {
      const legacyCandidates = unscopedSkillIdsByName.get(row.learningOutcome);
      const reusableLegacySkillId = legacyCandidates && legacyCandidates.length > 0
        ? legacyCandidates.shift()
        : undefined;

      if (reusableLegacySkillId) {
        const updatedSkill = await prisma.mathSkill.update({
          where: { id: reusableLegacySkillId },
          data: { mainTopicId },
          select: { id: true }
        });
        learningOutcomeSkillId = updatedSkill.id;
        stats.skillsScopedFromLegacy++;
      } else {
        const createdSkill = await prisma.mathSkill.create({
          data: {
            name: row.learningOutcome,
            mainTopicId
          },
          select: { id: true }
        });
        learningOutcomeSkillId = createdSkill.id;
        stats.skillsCreated++;
      }

      skillIdByKey.set(currentSkillKey, learningOutcomeSkillId);
    }

    const existingMapping = mappingByWorksheetNumber.get(row.worksheetNumber);
    if (!existingMapping) {
      const createdMapping = await prisma.worksheetSkillMap.create({
        data: {
          worksheetNumber: row.worksheetNumber,
          mathSkillId: learningOutcomeSkillId,
          isTest: row.isTest
        }
      });
      mappingByWorksheetNumber.set(row.worksheetNumber, createdMapping);
      stats.mappingsCreated++;
    } else if (existingMapping.mathSkillId !== learningOutcomeSkillId || existingMapping.isTest !== row.isTest) {
      const updatedMapping = await prisma.worksheetSkillMap.update({
        where: { id: existingMapping.id },
        data: {
          mathSkillId: learningOutcomeSkillId,
          isTest: row.isTest
        }
      });
      mappingByWorksheetNumber.set(row.worksheetNumber, updatedMapping);
      stats.mappingsUpdated++;
    } else {
      stats.mappingsUnchanged++;
    }

    if ((index + 1) % 500 === 0 || index + 1 === rows.length) {
      log(`Processed ${index + 1}/${rows.length} rows...`);
    }
  }

  log('Import summary', stats);
  return stats;
};

const main = async (): Promise<void> => {
  try {
    const workbookPath = resolveWorkbookPath(process.argv[2]);
    log(`Using workbook: ${workbookPath}`);

    const { rows, stats } = parseWorkbook(workbookPath);
    log(`Starting import of ${rows.length} parsed rows...`);

    await importCurriculum(rows);

    log('Curriculum import completed successfully.');
    log('Final parse stats', stats);
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to import curriculum:`, error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
};

void main();
