import Bottleneck from 'bottleneck';

export const gradingLimiter = new Bottleneck({
  maxConcurrent: parseInt(process.env.GRADING_MAX_CONCURRENT || '1', 10), // Changed default from 2 to 1 for sequential processing
  minTime: parseInt(process.env.GRADING_MIN_TIME_MS || '1000', 10) // Increased default from 200ms to 1000ms to give more time between requests
});

gradingLimiter.on('debug', (msg: unknown) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[gradingLimiter]', msg);
  }
});

export async function scheduleGrading<T>(fn: () => Promise<T>): Promise<T> {
  return gradingLimiter.schedule(fn);
}
