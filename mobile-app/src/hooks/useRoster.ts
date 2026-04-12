import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, AppStateStatus } from 'react-native';

import { apiClient } from '../api/client';
import { WorksheetSlotData } from '../components/WorksheetSlot';
import { listQueueItems, queueCapturedWorksheet } from '../queue/storage';
import { processUploadQueue } from '../queue/uploader';
import {
  CapturePageDraft,
  ClassDateResponse,
  CreateGradedWorksheetData,
  StudentSummary,
  TeacherClass,
  User,
  WorksheetRecord,
} from '../types';
import { toDateInputValue } from '../utils/date';
import { createLocalId } from '../utils/id';

const LAST_SELECTION_KEY = 'teacher-capture-last-selection';

interface LastSelection {
  classId: string;
  submittedOn: string;
}

export interface RosterStudent {
  studentId: string;
  studentName: string;
  tokenNumber: string;
  worksheets: WorksheetSlotData[];
}

function buildInitialWorksheet(
  _studentId: string,
  summary: StudentSummary | undefined,
  existing?: WorksheetRecord,
): WorksheetSlotData {
  if (existing) {
    return {
      worksheetEntryId: existing.id || createLocalId('entry'),
      worksheetNumber: existing.worksheetNumber ?? 0,
      grade: existing.grade != null ? String(existing.grade) : '',
      isAbsent: !!existing.isAbsent,
      isIncorrectGrade: !!existing.isIncorrectGrade,
      isUploading: false,
      page1Url: existing.images?.find((img) => img.pageNumber === 1)?.imageUrl ?? null,
      page2Url: existing.images?.find((img) => img.pageNumber === 2)?.imageUrl ?? null,
      gradingDetails: existing.gradingDetails ?? null,
      wrongQuestionNumbers: existing.wrongQuestionNumbers ?? null,
      id: existing.id ?? null,
      existing: true,
      isRepeated: existing.isRepeated ?? false,
    };
  }

  const wsNum = summary?.recommendedWorksheetNumber ?? 1;
  return {
    worksheetEntryId: createLocalId('entry'),
    worksheetNumber: wsNum,
    grade: '',
    isAbsent: false,
    isIncorrectGrade: false,
    isUploading: false,
    isRepeated: summary?.isRecommendedRepeated ?? false,
  };
}

export function useRoster(user: User) {
  const [classes, setClasses] = useState<TeacherClass[]>([]);
  const [selectedClassId, setSelectedClassIdRaw] = useState<string | null>(null);
  const [submittedOn, setSubmittedOnRaw] = useState(toDateInputValue());
  const [students, setStudents] = useState<RosterStudent[]>([]);
  const [stats, setStats] = useState<ClassDateResponse['stats'] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load classes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const teacherClasses = await apiClient.getTeacherClasses(user);
        if (cancelled) return;
        setClasses(teacherClasses);

        const stored = await AsyncStorage.getItem(LAST_SELECTION_KEY);
        const last: LastSelection | null = stored ? JSON.parse(stored) : null;
        if (last && teacherClasses.some((c) => c.id === last.classId)) {
          setSelectedClassIdRaw(last.classId);
          setSubmittedOnRaw(last.submittedOn || toDateInputValue());
        } else if (teacherClasses.length > 0) {
          setSelectedClassIdRaw(teacherClasses[0].id);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load classes');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Persist selection
  const setSelectedClassId = useCallback((id: string) => {
    setSelectedClassIdRaw(id);
    AsyncStorage.setItem(LAST_SELECTION_KEY, JSON.stringify({ classId: id, submittedOn }));
  }, [submittedOn]);

  const setSubmittedOn = useCallback((date: string) => {
    setSubmittedOnRaw(date);
    if (selectedClassId) {
      AsyncStorage.setItem(LAST_SELECTION_KEY, JSON.stringify({ classId: selectedClassId, submittedOn: date }));
    }
  }, [selectedClassId]);

  // Load roster
  const loadRoster = useCallback(async () => {
    if (!selectedClassId) return;
    setLoadingRoster(true);
    setError(null);
    try {
      const data = await apiClient.getClassWorksheetsForDate(selectedClassId, submittedOn);
      setStats(data.stats);

      const rosterStudents: RosterStudent[] = data.students.map((s) => {
        const existingWorksheets = data.worksheetsByStudent[s.id] || [];
        const summary = data.studentSummaries[s.id];

        const worksheets: WorksheetSlotData[] =
          existingWorksheets.length > 0
            ? existingWorksheets.map((ws) => buildInitialWorksheet(s.id, summary, ws))
            : [buildInitialWorksheet(s.id, summary)];

        return {
          studentId: s.id,
          studentName: s.name,
          tokenNumber: s.tokenNumber,
          worksheets,
        };
      });

      // Sort by token number
      rosterStudents.sort((a, b) => a.tokenNumber.localeCompare(b.tokenNumber, undefined, { numeric: true }));
      setStudents(rosterStudents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load roster');
    } finally {
      setLoadingRoster(false);
    }
  }, [selectedClassId, submittedOn]);

  useEffect(() => {
    loadRoster();
  }, [loadRoster]);

  // Background sync: merge grading results into existing state without
  // wiping local edits (unsaved grades, page URIs, etc.)
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const syncGradingResults = useCallback(async () => {
    if (!selectedClassId) return;
    try {
      const [data, queueItems] = await Promise.all([
        apiClient.getClassWorksheetsForDate(selectedClassId, submittedOn),
        listQueueItems({ submittedOn, classIds: [selectedClassId] }),
      ]);
      setStats(data.stats);

      // Build a set of student IDs that have active queue items
      const activeQueueStudents = new Set(
        queueItems
          .filter((qi) => qi.status !== 'completed' && qi.status !== 'failed')
          .map((qi) => qi.studentId),
      );

      setStudents((prev) =>
        prev.map((student) => {
          const serverWorksheets = data.worksheetsByStudent[student.studentId] || [];
          const isQueued = activeQueueStudents.has(student.studentId);

          if (serverWorksheets.length === 0 && !isQueued) return student;

          return {
            ...student,
            worksheets: student.worksheets.map((ws) => {
              // Find matching server worksheet by ID or worksheet number
              const match = serverWorksheets.find(
                (sw) =>
                  (ws.id && sw.id === ws.id) ||
                  (!ws.id && sw.worksheetNumber === ws.worksheetNumber),
              );
              // Lock card if student has active queue items
              if (!match && isQueued) return { ...ws, isUploading: true };
              if (!match) return ws;

              // Only update fields that come from grading — don't touch
              // local edits like page URIs, manual grade changes, etc.
              const hasNewGrade =
                match.gradingDetails &&
                (!ws.gradingDetails || JSON.stringify(match.gradingDetails) !== JSON.stringify(ws.gradingDetails));

              if (!hasNewGrade && ws.existing && !isQueued) return ws;

              return {
                ...ws,
                id: match.id ?? ws.id,
                existing: true,
                isUploading: isQueued,
                // Only overwrite grade/details if server has grading data
                // and local doesn't (or server has newer data)
                ...(match.gradingDetails
                  ? {
                      grade: match.grade != null ? String(match.grade) : ws.grade,
                      gradingDetails: match.gradingDetails,
                      wrongQuestionNumbers: match.wrongQuestionNumbers ?? ws.wrongQuestionNumbers,
                    }
                  : {}),
                // Preserve local page URIs — only pick up server URLs
                page1Url: match.images?.find((img) => img.pageNumber === 1)?.imageUrl ?? ws.page1Url,
                page2Url: match.images?.find((img) => img.pageNumber === 2)?.imageUrl ?? ws.page2Url,
                isAbsent: match.isAbsent ?? ws.isAbsent,
                isRepeated: match.isRepeated ?? ws.isRepeated,
              };
            }),
          };
        }),
      );
    } catch {
      // Silent — this is background sync
    }
  }, [selectedClassId, submittedOn]);

  useEffect(() => {
    if (!selectedClassId) return;
    // Poll every 10 seconds for grading updates
    syncIntervalRef.current = setInterval(syncGradingResults, 10_000);

    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        syncGradingResults();
      }
    });

    return () => {
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
      subscription.remove();
    };
  }, [selectedClassId, syncGradingResults]);

  // Filtered students
  const filteredStudents = useMemo(() => {
    if (!searchQuery.trim()) return students;
    const q = searchQuery.toLowerCase().trim();
    return students.filter(
      (s) =>
        s.studentName.toLowerCase().includes(q) ||
        s.tokenNumber.toLowerCase().includes(q),
    );
  }, [students, searchQuery]);

  // Update a worksheet field
  const updateField = useCallback(
    (worksheetEntryId: string, field: string, value: string | number | boolean) => {
      setStudents((prev) =>
        prev.map((student) => ({
          ...student,
          worksheets: student.worksheets.map((ws) => {
            if (ws.worksheetEntryId !== worksheetEntryId) return ws;

            if (field === 'isAbsent' && value === true) {
              return {
                ...ws,
                isAbsent: true,
                worksheetNumber: 0,
                grade: '',
                page1Uri: null,
                page2Uri: null,
              };
            }

            return { ...ws, [field]: value };
          }),
        })),
      );

      // Check isRepeated when worksheetNumber changes
      if (field === 'worksheetNumber' && typeof value === 'number' && value > 0 && selectedClassId) {
        const student = students.find((s) =>
          s.worksheets.some((ws) => ws.worksheetEntryId === worksheetEntryId),
        );
        if (student) {
          apiClient
            .checkIsRepeated(selectedClassId, student.studentId, value, submittedOn)
            .then((result) => {
              setStudents((prev) =>
                prev.map((s) => ({
                  ...s,
                  worksheets: s.worksheets.map((ws) =>
                    ws.worksheetEntryId === worksheetEntryId
                      ? { ...ws, isRepeated: result.isRepeated }
                      : ws,
                  ),
                })),
              );
            })
            .catch(() => undefined);
        }
      }
    },
    [selectedClassId, submittedOn, students],
  );

  // Set page image
  const setPageImage = useCallback(
    (worksheetEntryId: string, pageNumber: number, uri: string, _mimeType: string, _fileName: string) => {
      const key = pageNumber === 1 ? 'page1Uri' : 'page2Uri';
      setStudents((prev) =>
        prev.map((student) => ({
          ...student,
          worksheets: student.worksheets.map((ws) =>
            ws.worksheetEntryId === worksheetEntryId
              ? { ...ws, [key]: uri, isAbsent: false }
              : ws,
          ),
        })),
      );
    },
    [],
  );

  // Add worksheet
  const addWorksheet = useCallback((studentId: string) => {
    setStudents((prev) =>
      prev.map((student) => {
        if (student.studentId !== studentId) return student;
        const maxWs = Math.max(...student.worksheets.map((w) => w.worksheetNumber), 0);
        const newWs: WorksheetSlotData = {
          worksheetEntryId: createLocalId('entry'),
          worksheetNumber: maxWs + 1,
          grade: '',
          isAbsent: false,
          isIncorrectGrade: false,
          isUploading: false,
        };
        return { ...student, worksheets: [...student.worksheets, newWs] };
      }),
    );
  }, []);

  // Remove worksheet
  const removeWorksheet = useCallback((worksheetEntryId: string) => {
    setStudents((prev) =>
      prev.map((student) => {
        if (!student.worksheets.some((ws) => ws.worksheetEntryId === worksheetEntryId)) return student;
        if (student.worksheets.length <= 1) return student; // Keep at least one
        return {
          ...student,
          worksheets: student.worksheets.filter((ws) => ws.worksheetEntryId !== worksheetEntryId),
        };
      }),
    );
  }, []);

  // Save individual student worksheet
  const saveStudent = useCallback(
    async (worksheetEntryId: string) => {
      if (!selectedClassId) return;
      const student = students.find((s) =>
        s.worksheets.some((ws) => ws.worksheetEntryId === worksheetEntryId),
      );
      const ws = student?.worksheets.find((w) => w.worksheetEntryId === worksheetEntryId);
      if (!student || !ws) return;

      const gradeNum = ws.grade ? parseInt(ws.grade, 10) : 0;
      if (!ws.isAbsent && ws.worksheetNumber <= 0) {
        Alert.alert('Validation', 'Worksheet number is required.');
        return;
      }
      if (!ws.isAbsent && ws.grade && (Number.isNaN(gradeNum) || gradeNum < 0 || gradeNum > 40)) {
        Alert.alert('Validation', 'Grade must be between 0 and 40.');
        return;
      }

      const data: CreateGradedWorksheetData = {
        classId: selectedClassId,
        studentId: student.studentId,
        worksheetNumber: ws.worksheetNumber,
        grade: gradeNum,
        submittedOn: new Date(submittedOn).toISOString(),
        isAbsent: ws.isAbsent,
        isRepeated: ws.isRepeated ?? false,
        isIncorrectGrade: ws.isIncorrectGrade,
        gradingDetails: ws.gradingDetails,
        wrongQuestionNumbers: ws.wrongQuestionNumbers,
      };

      try {
        const saved =
          ws.id && ws.existing
            ? await apiClient.updateGradedWorksheet(ws.id, data)
            : await apiClient.createGradedWorksheet(data);

        setStudents((prev) =>
          prev.map((s) => ({
            ...s,
            worksheets: s.worksheets.map((w) =>
              w.worksheetEntryId === worksheetEntryId
                ? { ...w, id: saved.id, existing: true }
                : w,
            ),
          })),
        );

        Alert.alert('Saved', `${student.studentName} saved.`);
      } catch (err) {
        Alert.alert('Error', err instanceof Error ? err.message : 'Save failed');
      }
    },
    [selectedClassId, submittedOn, students],
  );

  // Save all
  const saveAll = useCallback(async () => {
    if (!selectedClassId) return;

    const toSave = students.flatMap((s) =>
      s.worksheets
        .filter((ws) => ws.isAbsent || ws.worksheetNumber > 0)
        .map((ws) => ({ student: s, ws })),
    );

    let successCount = 0;
    let failCount = 0;

    for (const { student, ws } of toSave) {
      const gradeNum = ws.grade ? parseInt(ws.grade, 10) : 0;
      const data: CreateGradedWorksheetData = {
        classId: selectedClassId,
        studentId: student.studentId,
        worksheetNumber: ws.worksheetNumber,
        grade: gradeNum,
        submittedOn: new Date(submittedOn).toISOString(),
        isAbsent: ws.isAbsent,
        isRepeated: ws.isRepeated ?? false,
        isIncorrectGrade: ws.isIncorrectGrade,
        gradingDetails: ws.gradingDetails,
        wrongQuestionNumbers: ws.wrongQuestionNumbers,
      };

      try {
        const saved =
          ws.id && ws.existing
            ? await apiClient.updateGradedWorksheet(ws.id, data)
            : await apiClient.createGradedWorksheet(data);

        setStudents((prev) =>
          prev.map((s) => ({
            ...s,
            worksheets: s.worksheets.map((w) =>
              w.worksheetEntryId === ws.worksheetEntryId
                ? { ...w, id: saved.id, existing: true }
                : w,
            ),
          })),
        );
        successCount++;
      } catch {
        failCount++;
      }
    }

    Alert.alert('Save All', `Saved: ${successCount}, Failed: ${failCount}`);
  }, [selectedClassId, submittedOn, students]);

  // AI Grade — queues to local SQLite
  const aiGrade = useCallback(
    async (worksheetEntryId: string) => {
      if (!selectedClassId) return;
      const student = students.find((s) =>
        s.worksheets.some((ws) => ws.worksheetEntryId === worksheetEntryId),
      );
      const ws = student?.worksheets.find((w) => w.worksheetEntryId === worksheetEntryId);
      if (!student || !ws) return;

      if (ws.worksheetNumber <= 0) {
        Alert.alert('Validation', 'Worksheet number is required.');
        return;
      }
      if (!ws.page1Uri && !ws.page1Url && !ws.page2Uri && !ws.page2Url) {
        Alert.alert('Validation', 'At least one page image is required.');
        return;
      }

      const pages: CapturePageDraft[] = [];
      if (ws.page1Uri) {
        pages.push({ pageNumber: 1, uri: ws.page1Uri, mimeType: 'image/jpeg', fileName: 'page-1.jpg' });
      }
      if (ws.page2Uri) {
        pages.push({ pageNumber: 2, uri: ws.page2Uri, mimeType: 'image/jpeg', fileName: 'page-2.jpg' });
      }

      if (pages.length === 0) {
        Alert.alert('Validation', 'No new page images to upload. Images are already saved on server.');
        return;
      }

      setStudents((prev) =>
        prev.map((s) => ({
          ...s,
          worksheets: s.worksheets.map((w) =>
            w.worksheetEntryId === worksheetEntryId ? { ...w, isUploading: true } : w,
          ),
        })),
      );

      try {
        const className = classes.find((c) => c.id === selectedClassId)?.name;
        await queueCapturedWorksheet({
          classId: selectedClassId,
          className: className ?? null,
          studentId: student.studentId,
          studentName: student.studentName,
          tokenNumber: student.tokenNumber,
          submittedOn,
          worksheetNumber: ws.worksheetNumber,
          isRepeated: ws.isRepeated ?? false,
          pages,
        });

        setStudents((prev) =>
          prev.map((s) => ({
            ...s,
            worksheets: s.worksheets.map((w) =>
              w.worksheetEntryId === worksheetEntryId
                ? { ...w, isUploading: false, page1Uri: null, page2Uri: null }
                : w,
            ),
          })),
        );

        Alert.alert('Queued', `${student.studentName} queued for AI grading.`);

        // Auto-process the queue
        processUploadQueue(apiClient).catch(() => undefined);
      } catch (err) {
        setStudents((prev) =>
          prev.map((s) => ({
            ...s,
            worksheets: s.worksheets.map((w) =>
              w.worksheetEntryId === worksheetEntryId ? { ...w, isUploading: false } : w,
            ),
          })),
        );
        Alert.alert('Error', err instanceof Error ? err.message : 'Failed to queue');
      }
    },
    [selectedClassId, submittedOn, students, classes],
  );

  // AI Grade All
  const aiGradeAll = useCallback(async () => {
    const eligible = students.flatMap((s) =>
      s.worksheets
        .filter(
          (ws) =>
            !ws.isAbsent &&
            ws.worksheetNumber > 0 &&
            (ws.page1Uri || ws.page2Uri),
        )
        .map((ws) => ws.worksheetEntryId),
    );

    if (eligible.length === 0) {
      Alert.alert('Nothing to grade', 'No worksheets have new page images to upload.');
      return;
    }

    for (const entryId of eligible) {
      await aiGrade(entryId);
    }
  }, [students, aiGrade]);

  // Mark ungraded as absent
  const markUngradedAbsent = useCallback(() => {
    const targets = searchQuery.trim() ? filteredStudents : students;
    const ungradedIds = new Set(
      targets
        .filter(
          (s) =>
            s.worksheets.every(
              (ws) => !ws.existing && !ws.grade && ws.worksheetNumber <= 0,
            ),
        )
        .map((s) => s.studentId),
    );

    if (ungradedIds.size === 0) {
      Alert.alert('No Changes', 'All students already have data.');
      return;
    }

    setStudents((prev) =>
      prev.map((student) => {
        if (!ungradedIds.has(student.studentId)) return student;
        return {
          ...student,
          worksheets: student.worksheets.map((ws) => ({
            ...ws,
            isAbsent: true,
            worksheetNumber: 0,
            grade: '',
            page1Uri: null,
            page2Uri: null,
          })),
        };
      }),
    );

    Alert.alert('Done', `${ungradedIds.size} students marked absent.`);
  }, [students, filteredStudents, searchQuery]);

  // Helper getters
  const getWorksheet = useCallback(
    (worksheetEntryId: string) =>
      students
        .flatMap((s) => s.worksheets)
        .find((ws) => ws.worksheetEntryId === worksheetEntryId),
    [students],
  );

  const findStudentForWorksheet = useCallback(
    (worksheetEntryId: string) =>
      students.find((s) =>
        s.worksheets.some((ws) => ws.worksheetEntryId === worksheetEntryId),
      ),
    [students],
  );

  return {
    classes,
    selectedClassId,
    submittedOn,
    students,
    filteredStudents,
    searchQuery,
    loading,
    loadingRoster,
    error,
    stats,
    setSelectedClassId,
    setSubmittedOn,
    setSearchQuery,
    updateField,
    setPageImage,
    addWorksheet,
    removeWorksheet,
    saveStudent,
    saveAll,
    aiGrade,
    aiGradeAll,
    markUngradedAbsent,
    refreshRoster: loadRoster,
    getWorksheet,
    findStudentForWorksheet,
  };
}
