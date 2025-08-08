declare module 'bottleneck' {
  interface BottleneckOptions {
    maxConcurrent?: number | null;
    minTime?: number;
    reservoir?: number | null;
  }
  type Job = () => Promise<unknown>;
  class Bottleneck {
    constructor(options?: BottleneckOptions);
    schedule<T>(fn: () => Promise<T>): Promise<T>;
    on(event: string, handler: (...args: any[]) => void): void;
  }
  export default Bottleneck;
}
