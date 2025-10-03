# Admin Comments Export Script

This folder contains exported data from the worksheet admin comments export script.

## Running the Script

From the `backend` directory, run:

```bash
npm run export-admin-comments
```

Or directly with ts-node:

```bash
ts-node src/scripts/export-admin-comments.ts
```

## Output Files

The script generates the following JSON files:

### 1. `admin-comments-page-{N}.json`
- One file per page number
- Contains all worksheets with admin comments for that specific page
- Example: `admin-comments-page-1.json`, `admin-comments-page-2.json`, etc.

Structure:
```json
{
  "pageNumber": 1,
  "totalComments": 5,
  "comments": [
    {
      "worksheetNumber": 123,
      "worksheetId": "uuid",
      "adminComments": "Grade seems incorrect...",
      "imageUrl": "https://...",
      "grade": 35,
      "outOf": 40,
      "studentId": "uuid",
      "submittedOn": "2025-01-15T10:30:00.000Z"
    }
  ]
}
```

### 2. `admin-comments-all.json`
- Summary file with all admin comments
- Includes statistics and grouped data
- Contains complete list of all comments across all pages

Structure:
```json
{
  "totalWorksheets": 10,
  "totalCommentsByPage": 3,
  "exportDate": "2025-10-03T12:00:00.000Z",
  "commentsByPage": [
    {
      "pageNumber": 1,
      "count": 5,
      "worksheetNumbers": [123, 456]
    }
  ],
  "allComments": [...]
}
```

## What the Script Does

1. Queries the Prisma database for all worksheets with `adminComments` not null
2. Includes the worksheet template (for worksheet number) and images
3. Groups the data by page number
4. Saves individual JSON files for each page number
5. Creates a summary file with all comments and statistics

## Data Included

For each worksheet with admin comments, the script exports:
- `worksheetNumber`: The template worksheet number
- `worksheetId`: Unique worksheet ID
- `adminComments`: The admin's comments
- `pageNumber`: Page number of the worksheet image
- `imageUrl`: URL to the worksheet image
- `grade`: Student's grade
- `outOf`: Maximum possible score
- `studentId`: ID of the student
- `submittedOn`: Submission date
