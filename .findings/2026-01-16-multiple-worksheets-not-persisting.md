# Multiple Worksheets Not Persisting After Manual Save

**Date**: 2026-01-16  
**Severity**: High  
**Status**: ✅ Fixed  
**Component**: Frontend - Teacher Worksheet Upload

## Problem Description

When a teacher added multiple worksheets to a student (via the `+` button) and manually saved them with grades, only the **last saved worksheet** would persist after a page refresh. All previously saved worksheets for that student on that date were lost.

**Expected**: Multiple worksheets per student per date should all persist  
**Actual**: Only the last saved worksheet remained after refresh  

**Note**: AI-graded worksheets did NOT have this issue - they correctly created multiple worksheet records.

## Root Causes

### 1. Shared DOM Element IDs
**File**: `student-worksheet-card.tsx`

All input fields for a student's worksheets used `studentId` in their IDs:
```tsx
id={`worksheet-${worksheet.studentId}`}
id={`grade-${worksheet.studentId}`}
```

When a student had multiple worksheets (e.g., Worksheet #1 and Worksheet #2), they **shared the same input IDs**. This caused DOM conflicts where editing Worksheet #2's inputs would actually modify Worksheet #1's fields in the React state.

### 2. Incorrect Worksheet Lookup in Save Function
**File**: `page.tsx:812`

The `handleSaveStudent` function looked up worksheets by `studentId`:
```typescript
const currentStudentData = studentWorksheets.find(w => w.studentId === worksheet.studentId);
```

This **always returned the first worksheet** for that student, regardless of which worksheet's Save button was clicked.

### 3. Wrong Create vs Update Logic
**File**: `page.tsx:946-956`

The save logic fetched "any worksheet for this class/student/date":
```typescript
const existingWorksheet = await worksheetAPI.getWorksheetByClassStudentDate(
    selectedClass, studentId, submittedOn
);
if (existingWorksheet && existingWorksheet.id) {
    await updateGradedWorksheet(existingWorksheet.id, data);
}
```

Since `getWorksheetByClassStudentDate` returns **only one worksheet**, saving Worksheet #2 would find and **update Worksheet #1's record** instead of creating a new one.

## Solution

### Fix #1: Use Unique Worksheet Entry IDs for DOM Elements
**File**: `student-worksheet-card.tsx:316-527`

Changed all input field IDs from `studentId` to `worksheetEntryId`:
```tsx
// BEFORE
id={`worksheet-${worksheet.studentId}`}

// AFTER  
id={`worksheet-${worksheet.worksheetEntryId}`}
```

**Files changed**: 5 input fields (worksheet #, grade, wrong questions, absent checkbox, incorrect grade checkbox)

### Fix #2: Lookup by Worksheet Entry ID
**File**: `page.tsx:812`

Changed save function to find the specific worksheet being saved:
```typescript
// BEFORE
const currentStudentData = studentWorksheets.find(w => w.studentId === worksheet.studentId);

// AFTER
const currentStudentData = studentWorksheets.find(w => w.worksheetEntryId === worksheet.worksheetEntryId);
```

### Fix #3: Check Specific Worksheet's Existence
**File**: `page.tsx:945-953`

Changed from fetching "any worksheet" to checking if **this specific worksheet** already exists:
```typescript
// BEFORE - Would find worksheet #1 and update it
const existingWorksheet = await worksheetAPI.getWorksheetByClassStudentDate(...);
if (existingWorksheet && existingWorksheet.id) {
    await updateGradedWorksheet(existingWorksheet.id, data);
}

// AFTER - Checks if this worksheet has an ID
if (currentStudentData.id && currentStudentData.existing) {
    await updateGradedWorksheet(currentStudentData.id, data);
} else {
    await createGradedWorksheet(data);
}
```

### Fix #4: Bulk Save Logic (handleSaveAllChanges)
**File**: `page.tsx:1044, 1077`

The "Save All" feature also had the same bug where it would overwrite multiple worksheets for the same student.
Changed logic to check `worksheet.id` and `worksheet.existing` inside the bulk save loop as well.

## Key Learnings

1. **Use unique identifiers for DOM elements** when dealing with arrays of similar items (worksheets, in this case). Using a shared identifier like `studentId` causes conflicts when multiple instances exist.

2. **Be specific in lookups**: When finding items in arrays, use the most specific identifier available (`worksheetEntryId`) rather than a shared one (`studentId`).

3. **Check the right thing for existence**: Don't query for "any record matching some criteria" when you should be checking if "this specific record" already exists. The former can return the wrong record.

4. **AI vs Manual save paths might differ**: AI grading worked correctly because it bypassed the problematic lookup logic and directly created records. Always test both manual and automated workflows.

## Files Modified

- [`student-worksheet-card.tsx`](file:///c:/Users/ayamu/python-programs/Git-Uploads/learnoai/saarthiEd/worksheet-grading/web-app/app/dashboard/teacher/worksheets/upload/student-worksheet-card.tsx)
  - Lines 316, 318, 329, 378, 382, 509, 520: Changed input IDs from `studentId` to `worksheetEntryId`
  - Line 327: Fixed JSX nesting structure

- [`page.tsx`](file:///c:/Users/ayamu/python-programs/Git-Uploads/learnoai/saarthiEd/worksheet-grading/web-app/app/dashboard/teacher/worksheets/upload/page.tsx)
  - Line 812: Changed worksheet lookup to use `worksheetEntryId`
  - Lines 945-953: Changed create/update logic to check specific worksheet's ID
  - Line 965: Updated PostHog tracking
  - Line 977: Changed state update to match by `worksheetEntryId`

## Related Issues

This pattern could occur anywhere in the codebase where:
- Multiple similar items share DOM element IDs based on a parent identifier
- Lookups use non-unique identifiers when unique ones are available
- Create/update logic queries for "any matching record" instead of checking specific record existence
