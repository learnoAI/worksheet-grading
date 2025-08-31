# Sequential AI Grading Implementation

## Overview
This document describes the changes made to implement sequential (one-by-one) AI grading instead of batch processing to improve reliability and prevent failed grading attempts.

## Problem
When attempting bulk grading from the teacher side, only a few worksheets were getting graded successfully while others failed. This was due to:
- Multiple concurrent requests overwhelming the AI grading service
- The FastAPI backend not being able to handle multiple simultaneous grading requests efficiently

## Solution
Implemented sequential processing where worksheets are graded one at a time instead of in batches.

## Changes Made

### 1. Frontend Changes (`web-app/app/dashboard/teacher/worksheets/upload/page.tsx`)

#### Before (Batch Processing):
- Processed worksheets in batches of 10 using `Promise.allSettled`
- Multiple worksheets were sent for grading simultaneously

#### After (Sequential Processing):
- Process worksheets one by one in a for loop
- Each worksheet waits for the previous one to complete before starting
- Added progress indicators showing "Processing worksheet X of Y: Student Name"
- Added 500ms delay between requests to prevent overwhelming the server

### 2. Backend Changes (`backend/src/services/gradingLimiter.ts`)

#### Configuration Updates:
- **maxConcurrent**: Changed default from `2` to `1` (ensures only one grading request is processed at a time)
- **minTime**: Changed default from `200ms` to `1000ms` (adds minimum 1 second between requests)

## Configuration

### Environment Variables
You can control the grading behavior using these environment variables in the backend:

```env
# Maximum concurrent AI grading requests (default: 1)
GRADING_MAX_CONCURRENT=1

# Minimum time between AI grading requests in milliseconds (default: 1000ms)
GRADING_MIN_TIME_MS=1000
```

### Recommended Settings:
- **For Production**: Keep `GRADING_MAX_CONCURRENT=1` to ensure reliability
- **For Testing**: You may increase to `2` or `3` if your AI service can handle it
- **minTime**: Adjust based on your AI service response time (1000-2000ms recommended)

## Benefits

1. **Improved Reliability**: Each worksheet gets processed completely before moving to the next
2. **Better Error Handling**: Individual failures are isolated and reported clearly
3. **Progress Visibility**: Teachers can see which student's worksheet is currently being processed
4. **Server Stability**: Prevents overwhelming the AI grading service with concurrent requests
5. **Predictable Behavior**: Sequential processing ensures consistent results

## User Experience

### For Teachers:
1. Click "AI Grade All" button to start sequential grading
2. See progress notifications: "Processing worksheet 3 of 10: John Smith"
3. Individual success/failure messages for each worksheet
4. Summary at the end showing total successful and failed gradings

### Error Messages:
- Individual worksheet failures show specific error messages
- Failed worksheets can be retried individually
- Clear indication of which students' worksheets failed

## Performance Considerations

While sequential processing is slower than batch processing, it provides:
- **Higher success rate**: More worksheets get graded successfully
- **Better reliability**: Fewer random failures
- **Clearer feedback**: Teachers know exactly which worksheets succeeded or failed

### Time Estimates:
- With 1 second minimum between requests
- Each worksheet takes approximately 2-5 seconds to process
- A class of 30 students: ~2-3 minutes total

## Troubleshooting

### If grading is still failing:
1. Check the Python FastAPI service is running
2. Verify `PYTHON_API_URL` is correctly set in backend `.env`
3. Check server logs for specific error messages
4. Consider increasing `GRADING_MIN_TIME_MS` if the AI service needs more time

### To temporarily revert to batch processing:
1. Set `GRADING_MAX_CONCURRENT=5` in backend `.env`
2. Restart the backend service
3. Note: This may cause the original issue to return

## Future Improvements

Potential enhancements to consider:
1. Add a queue system for grading requests
2. Implement retry logic for failed worksheets
3. Add a progress bar UI component instead of toast notifications
4. Store grading jobs in database for better tracking
5. Implement background processing with job status updates
