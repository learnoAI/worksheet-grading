import * as FileSystem from 'expo-file-system/legacy';

import { ApiClient } from '../api/client';
import {
  DirectUploadItem,
  DirectUploadWorksheetRequest,
  GradingJob,
  QueueStatus,
  QueueWorksheet,
} from '../types';
import {
  deleteLocalFilesForItem,
  listItemsForUpload,
  listKnownJobItems,
  listQueueItems,
  markItemFinalized,
  markPageUploadStatus,
  markWorksheetUploading,
  resetItemForRetry,
  saveUploadSessionItem,
  updateStatusFromGradingJob,
  updateWorksheetStatus,
} from './storage';

export type UploadWorkerResult = {
  processed: number;
  failed: number;
};

function worksheetKey(item: Pick<QueueWorksheet, 'studentId' | 'worksheetNumber'>): string {
  return `${item.studentId}:${item.worksheetNumber}`;
}

function groupBy<T>(items: T[], getKey: (item: T) => string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((groups, item) => {
    const key = getKey(item);
    groups[key] = groups[key] ?? [];
    groups[key].push(item);
    return groups;
  }, {});
}

function buildUploadRequest(item: QueueWorksheet): DirectUploadWorksheetRequest {
  return {
    studentId: item.studentId,
    studentName: item.studentName,
    tokenNo: item.tokenNumber,
    worksheetNumber: item.worksheetNumber,
    worksheetName: String(item.worksheetNumber),
    isRepeated: item.isRepeated,
    files: item.pages.map((page) => ({
      pageNumber: page.pageNumber,
      fileName: page.fileName,
      mimeType: page.mimeType,
      fileSize: Math.max(page.fileSize ?? 1, 1),
    })),
  };
}

function findSessionItem(item: QueueWorksheet, sessionItems: DirectUploadItem[]): DirectUploadItem | undefined {
  if (item.backendItemId) {
    const byItemId = sessionItems.find((sessionItem) => sessionItem.itemId === item.backendItemId);
    if (byItemId) {
      return byItemId;
    }
  }

  return sessionItems.find((sessionItem) => worksheetKey(sessionItem) === worksheetKey(item));
}

async function createMissingUploadSessions(api: ApiClient, items: QueueWorksheet[]) {
  const withoutSession = items.filter((item) => !item.backendBatchId && item.status !== 'uploaded');
  const groups = groupBy(withoutSession, (item) => `${item.classId}:${item.submittedOn}`);

  for (const group of Object.values(groups)) {
    if (group.length === 0) {
      continue;
    }

    try {
      const session = await api.createDirectUploadSession(
        group[0].classId,
        group[0].submittedOn,
        group.map(buildUploadRequest),
      );

      for (const item of group) {
        const sessionItem = findSessionItem(item, session.items);
        if (sessionItem) {
          await saveUploadSessionItem(item, sessionItem, session.batchId);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create upload session';
      await Promise.all(group.map((item) => updateWorksheetStatus(item.localId, 'failed', message)));
    }
  }
}

async function refreshKnownUploadSessions(api: ApiClient, items: QueueWorksheet[]) {
  const batches = groupBy(
    items.filter((item) => item.backendBatchId),
    (item) => item.backendBatchId || '',
  );

  for (const [batchId, batchItems] of Object.entries(batches)) {
    if (!batchId) {
      continue;
    }

    try {
      const session = await api.getDirectUploadSession(batchId);
      for (const item of batchItems) {
        const sessionItem = findSessionItem(item, session.items);
        if (sessionItem) {
          await saveUploadSessionItem(item, sessionItem, session.batchId);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to refresh upload session';
      await Promise.all(batchItems.map((item) => updateWorksheetStatus(item.localId, 'failed', message)));
    }
  }
}

function uploadUrlIsStale(expiresAt?: string | null): boolean {
  if (!expiresAt) {
    return true;
  }

  return new Date(expiresAt).getTime() < Date.now() + 60_000;
}

async function uploadItemPages(item: QueueWorksheet): Promise<void> {
  await markWorksheetUploading(item.localId);

  for (const page of item.pages) {
    if (page.uploadStatus === 'uploaded') {
      continue;
    }

    if (!page.uploadUrl || !page.imageId || uploadUrlIsStale(page.uploadUrlExpiresAt)) {
      throw new Error('Upload URL is missing or expired. Retry will refresh it.');
    }

    await markPageUploadStatus(page.id, 'uploading', null);

    const result = await FileSystem.uploadAsync(page.uploadUrl, page.localUri, {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: {
        'Content-Type': page.mimeType,
      },
      sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
    });

    if (result.status < 200 || result.status > 299) {
      throw new Error(`Storage upload failed (${result.status})`);
    }

    await markPageUploadStatus(page.id, 'uploaded', null);
  }
}

async function uploadReadyPages(): Promise<UploadWorkerResult> {
  const items = await listItemsForUpload();
  let processed = 0;
  let failed = 0;

  for (const item of items) {
    if (!item.backendBatchId || item.status === 'uploaded') {
      continue;
    }

    try {
      await uploadItemPages(item);
      processed += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : 'Upload failed';
      const refreshed = await listItemsForUpload();
      const current = refreshed.find((candidate) => candidate.localId === item.localId) ?? item;
      const page = current.pages.find((candidate) => candidate.uploadStatus === 'uploading');
      if (page) {
        await markPageUploadStatus(page.id, 'failed', message);
      }
      await updateWorksheetStatus(item.localId, 'failed', message);
    }
  }

  return { processed, failed };
}

async function finalizeReadyBatches(api: ApiClient) {
  const items = await listItemsForUpload();
  const batches = groupBy(
    items.filter((item) => item.backendBatchId && item.pages.every((page) => page.uploadStatus === 'uploaded')),
    (item) => item.backendBatchId || '',
  );

  for (const [batchId, batchItems] of Object.entries(batches)) {
    if (!batchId || batchItems.length === 0) {
      continue;
    }

    const uploadedImageIds = batchItems
      .flatMap((item) => item.pages)
      .map((page) => page.imageId)
      .filter((imageId): imageId is string => Boolean(imageId));

    try {
      const result = await api.finalizeDirectUploadSession(batchId, uploadedImageIds);
      const byItemId = new Map(batchItems.map((item) => [item.backendItemId, item]));

      for (const queued of result.queued) {
        const item = byItemId.get(queued.itemId);
        if (!item) {
          continue;
        }

        await markItemFinalized(item.localId, queued.jobId);
        await deleteLocalFilesForItem(item);
      }

      for (const pending of result.pending) {
        const item = byItemId.get(pending.itemId);
        if (item) {
          await updateWorksheetStatus(item.localId, 'uploaded', 'Waiting for backend upload confirmation');
        }
      }

      for (const failed of result.failed) {
        const item = byItemId.get(failed.itemId);
        if (item) {
          await updateWorksheetStatus(item.localId, 'failed', failed.error || 'Backend finalization failed');
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to finalize upload session';
      await Promise.all(batchItems.map((item) => updateWorksheetStatus(item.localId, 'failed', message)));
    }
  }
}

function mapJobStatus(job: GradingJob): QueueStatus {
  if (job.status === 'COMPLETED') {
    return 'completed';
  }

  if (job.status === 'FAILED') {
    return 'failed';
  }

  if (job.status === 'PROCESSING') {
    return 'processing';
  }

  return 'grading_queued';
}

export async function refreshGradingStatuses(api: ApiClient): Promise<void> {
  const knownJobs = await listKnownJobItems();
  const jobIds = knownJobs.map((item) => item.jobId).filter((jobId): jobId is string => Boolean(jobId));

  if (jobIds.length === 0) {
    return;
  }

  const response = await api.getBatchJobStatus(jobIds);
  await Promise.all(
    response.jobs.map((job) =>
      updateStatusFromGradingJob(job.id, mapJobStatus(job), job.errorMessage || job.dispatchError || null),
    ),
  );
}

export async function refreshClassDateStatuses(
  api: ApiClient,
  classId: string,
  submittedOn: string,
): Promise<void> {
  const response = await api.getJobsByClassAndDate(classId, submittedOn);
  const localItems = await listQueueItems();
  const localByJobId = new Set(localItems.map((item) => item.jobId).filter(Boolean));

  await Promise.all(
    response.jobs
      .filter((job) => localByJobId.has(job.id))
      .map((job) =>
        updateStatusFromGradingJob(job.id, mapJobStatus(job), job.errorMessage || job.dispatchError || null),
      ),
  );
}

export async function processUploadQueue(api: ApiClient): Promise<UploadWorkerResult> {
  let items = await listItemsForUpload();

  for (const item of items.filter((candidate) => candidate.status === 'failed')) {
    await resetItemForRetry(item.localId);
  }

  items = await listItemsForUpload();
  await createMissingUploadSessions(api, items);
  items = await listItemsForUpload();
  await refreshKnownUploadSessions(api, items);

  const uploadResult = await uploadReadyPages();
  await finalizeReadyBatches(api);
  await refreshGradingStatuses(api);

  return uploadResult;
}
