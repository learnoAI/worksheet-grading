import Bottleneck from 'bottleneck';

export const gradingLimiter = new Bottleneck({
  maxConcurrent: parseInt(process.env.GRADING_MAX_CONCURRENT || '2', 10),
  minTime: parseInt(process.env.GRADING_MIN_TIME_MS || '200', 10)
});

gradingLimiter.on('debug', (msg: unknown) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[gradingLimiter]', msg);
  }
});

export async function scheduleGrading<T>(fn: () => Promise<T>): Promise<T> {
  return gradingLimiter.schedule(fn);
}
