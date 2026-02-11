import Bottleneck from 'bottleneck';
import config from '../config/env';

export const gradingLimiter = new Bottleneck({
  maxConcurrent: config.grading.maxConcurrent,
  minTime: config.grading.minTimeMs
});

gradingLimiter.on('debug', (msg: unknown) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[gradingLimiter]', msg);
  }
});

export async function scheduleGrading<T>(fn: () => Promise<T>): Promise<T> {
  return gradingLimiter.schedule(fn);
}
