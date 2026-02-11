import { startGradingDispatchLoop } from './gradingDispatchLoop';
import { startGradingWorker } from './gradingWorker';

async function main(): Promise<void> {
    startGradingDispatchLoop();
    await startGradingWorker();
}

void main().catch((error) => {
    const message = error instanceof Error ? error.message : 'Unknown worker error';
    console.error('Worker process crashed:', message);
    process.exit(1);
});
