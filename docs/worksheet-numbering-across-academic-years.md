# Worksheet Numbering Across Academic Years

This document explains how worksheet numbering works when students are archived from one academic year and onboarded into a new class for the next year.

## Design Decision

Worksheet numbers **carry over globally** across all classes a student has ever been in. When a student moves from "3rd (25-26)" to "4th (26-27)", their worksheet number continues from where they left off (e.g., 348 instead of restarting at 1).

The **"repeated" flag** (`isRecommendedRepeated`) is scoped to the **current class only** — a worksheet completed in an old class is not considered "repeated" in the new class.

## How It Works

- **Recommendation query**: Fetches worksheet history across ALL classes for the student (`WHERE studentId = ?`)
- **Repeat check**: Separate query scoped to current class (`WHERE classId = ? AND studentId = ?`)
- **Progression threshold**: Uses the most recent grade across all classes to decide advance vs repeat (default: 32 marks)

## Scenario Comparison: Old vs New Approach

### Setup

- Student: **Aarav** (token: TN001)
- Old class: **3rd (25-26)** at School A
- New class: **4th (26-27)** at School A
- Progression threshold: 32 marks

---

### Scenario 1: Student completed worksheets 1-347, last grade 35/40 (above threshold)

**Old approach (class-scoped):**
- Archive 25-26 -> Aarav archived, worksheets 1-347 stay in "3rd (25-26)"
- Onboard to "4th (26-27)" -> Aarav unarchived
- Teacher opens upload page -> query: `WHERE classId = '4th (26-27)' AND studentId = Aarav`
- Result: **0 worksheets found** -> recommends **worksheet 1**, `isRepeated = false`
- Aarav restarts from scratch

**New approach (student-scoped):**
- Same archive + onboard steps
- Teacher opens upload page -> query: `WHERE studentId = Aarav` (all classes)
- Result: 347 worksheets found, last was #347 with grade 35 (above threshold)
- Recommends **worksheet 348**, `isRepeated = false`
- Aarav continues where they left off

---

### Scenario 2: Student's last worksheet #347 scored 20/40 (below threshold)

**Old approach:**
- Onboard to "4th (26-27)"
- Query finds 0 worksheets -> recommends **worksheet 1**, `isRepeated = false`
- Student should have repeated 347, but system doesn't know

**New approach:**
- Query finds all history, last worksheet #347 scored 20 (below 32)
- Recommends **worksheet 347** (repeat), `isRecommendedRepeated = true`
- Correct -- they need to repeat it even though they moved to a new class

---

### Scenario 3: Student was absent for worksheet 347, last completed was 346 with grade 38/40

**Old approach:**
- Recommends worksheet 1 (no history in new class)

**New approach:**
- Query filters `isAbsent: false`, so worksheet 347 (absent) is excluded
- Last completed: #346, grade 38 (above threshold)
- Recommends **worksheet 347**, `isRepeated = false`
- Correct -- they missed 347 due to absence and should attempt it

---

### Scenario 4: Student did worksheets 1-50 in "3rd (25-26)" and also had worksheets 1-30 in "2nd (24-25)" from prior year

**Old approach:**
- Only sees current class -> recommends worksheet 1 in "4th (26-27)"

**New approach:**
- Sees all history: worksheets 1-30 from 2nd class + 1-50 from 3rd class
- `completedWorksheetNumbers` = [1, 2, ..., 50] (deduplicated, highest is 50)
- Last worksheet by date: #50 from "3rd (25-26)"
- If grade >= threshold -> recommends **worksheet 51**
- `isRepeated` checks current class "4th (26-27)" -> 0 worksheets there -> `isRepeated = false`
- Correct behavior

---

### Scenario 5: Student did worksheet 51 in old class, scored low, then was archived before repeating

**Old approach:**
- New class -> recommends worksheet 1

**New approach:**
- Last worksheet: #51, grade 20 (below threshold)
- Recommends **worksheet 51** (repeat), `isRecommendedRepeated = true`
- Teacher sees "Repeat" badge -- knows student needs to redo this one
- Correct behavior

---

### Scenario 6: Student is in TWO active classes simultaneously (e.g., "4th (26-27)" and "Remedial (26-27)")

**Old approach:**
- Each class had independent history
- "4th" might show worksheet 50, "Remedial" shows worksheet 10
- Two separate progressions

**New approach:**
- Both classes see the SAME global history
- If student does worksheet 50 in "4th", then opens "Remedial" -> recommendation says 51
- `isRepeated` is scoped to each class, so worksheet 50 shows as `isRepeated = false` in "Remedial" (never done there) but the recommended number is 51 (global)
- **Edge case**: Teacher in "Remedial" might expect student to start at 1, but system says 51
- **Verdict**: This is the intended behavior, but worth being aware of

---

### Scenario 7: Student transfers from School A to School B (different school, different worksheet templates)

**Old approach:**
- Clean slate at School B -> worksheet 1

**New approach:**
- Sees School A history (worksheets 1-100)
- Recommends **worksheet 101** at School B
- BUT School B might only have templates for worksheets 1-75
- Template lookup for #101 fails -> worksheet created without template
- **Potential issue** -- does not apply if students stay within the same school

---

### Scenario 8: Teacher manually changes worksheet number for a student

**Old approach:**
- Teacher sets worksheet #5 -> `checkIsRepeated` checks current class -> "not repeated"

**New approach:**
- Teacher sets worksheet #5 -> `checkIsRepeated` still checks **current class only** (unchanged)
- If student did #5 in old class but not in new class -> "not repeated" (correct)
- If student did #5 in current class already -> "repeated" (correct)
- No change in behavior here

---

### Scenario 9: Student re-onboarded to same school but skipped a year (was out for 25-26, back for 26-27)

**Old approach:**
- Last class was "3rd (24-25)", worksheet 200
- New class "3rd (26-27)" -> recommends worksheet 1

**New approach:**
- Sees history from "3rd (24-25)", last worksheet 200, grade 35
- Recommends **worksheet 201** in "3rd (26-27)"
- `isRepeated = false` (never done in current class)
- Student continues from 201 despite the gap year

---

### Scenario 10: Bulk class view -- teacher opens daily upload page for "4th (26-27)" with 50 students

**Old approach:**
- Batch query: `WHERE classId = '4th (26-27)' AND studentId IN (...)` -> ~0 rows for new class
- All students start at worksheet 1

**New approach:**
- Two parallel queries:
  1. Global: `WHERE studentId IN (...)` -> all cross-class history (for progression numbers)
  2. Current class: `WHERE classId = '4th (26-27)' AND studentId IN (...)` -> for repeat checking
- Each student gets their correct continued worksheet number
- `isRepeated` only flags worksheets already done in "4th (26-27)"
- Performance: both queries run in parallel, index on `(studentId, submittedOn)` covers both

---

## Summary Table

| Scenario | Old: Recommended # | Old: isRepeated | New: Recommended # | New: isRepeated |
|----------|--------------------|-----------------|--------------------|-----------------|
| 1. Last WS 347, grade 35 (pass) | 1 | false | **348** | false |
| 2. Last WS 347, grade 20 (fail) | 1 | false | **347** | true |
| 3. Absent for 347, last was 346 pass | 1 | false | **347** | false |
| 4. History across 2 old classes (max 50) | 1 | false | **51** | false |
| 5. Last WS 51 fail, archived before repeat | 1 | false | **51** | true |
| 6. Two active classes simultaneously | Independent per class | per class | **Global number** | per class |
| 7. School transfer (A->B) | 1 | false | **101** | false (template may not exist) |
| 8. Teacher manual override | per class check | per class | per class check | **per class** |
| 9. Skipped a year | 1 | false | **201** | false |
| 10. Bulk class view (50 students) | All start at 1 | false | **Each continues** | per class |

## Technical Details

### Files modified

- `backend/src/services/worksheetRecommendation.ts` -- `buildWorksheetRecommendationFromHistory()` accepts optional `currentClassCompletedNumbers` for scoped repeat-checking
- `backend/src/controllers/worksheetController.ts`:
  - `getRecommendedWorksheet()` -- fetches global + current-class history in parallel
  - `getClassWorksheetsForDate()` -- same parallel query pattern for batch recommendations
  - `checkIsRepeated()` -- remains scoped to current class (no change needed)

### Database

- No schema changes required
- Existing index `Worksheet_studentId_submittedOn_idx` covers the student-scoped query
- Unique constraint `unique_worksheet_per_student_day` on `(studentId, classId, worksheetNumber, submittedOn)` still works -- different classId means no conflict
