import { MongoClient, Collection } from 'mongodb';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
    timestamp: Date;
    level: LogLevel;
    source: string;
    message: string;
    data?: Record<string, any>;
    duration?: number;
    stack?: string;
}

let collection: Collection<LogEntry> | null = null;
let lastConnectionAttemptAt = 0;

const CONNECTION_RETRY_MS = 60_000;

async function getCollection(): Promise<Collection<LogEntry> | null> {
    if (collection) return collection;
    if (Date.now() - lastConnectionAttemptAt < CONNECTION_RETRY_MS) return null;

    lastConnectionAttemptAt = Date.now();
    const mongoUrl = process.env.MONGO_URL;
    if (!mongoUrl) return null;

    try {
        const client = new MongoClient(mongoUrl);
        await client.connect();
        collection = client.db().collection<LogEntry>('app_logs');
        return collection;
    } catch {
        return null;
    }
}

const LOG_LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
};

const currentLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(level: LogLevel, source: string, message: string, data?: Record<string, any>): string {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] [${source}] ${message}${dataStr}`;
}

async function log(level: LogLevel, source: string, message: string, data?: Record<string, any>, error?: Error): Promise<void> {
    if (!shouldLog(level)) return;

    const formattedMessage = formatMessage(level, source, message, data);

    // Console output
    switch (level) {
        case 'debug':
            console.debug(formattedMessage);
            break;
        case 'info':
            console.info(formattedMessage);
            break;
        case 'warn':
            console.warn(formattedMessage);
            break;
        case 'error':
            console.error(formattedMessage);
            if (error?.stack) console.error(error.stack);
            break;
    }

    // MongoDB logging (async, don't await)
    const col = await getCollection();
    if (col) {
        const doc: LogEntry = {
            timestamp: new Date(),
            level,
            source,
            message,
            data,
            stack: error?.stack
        };
        col.insertOne(doc).catch(() => { });
    }
}

// Logger factory for a specific source
export function createLogger(source: string) {
    return {
        debug: (message: string, data?: Record<string, any>) => log('debug', source, message, data),
        info: (message: string, data?: Record<string, any>) => log('info', source, message, data),
        warn: (message: string, data?: Record<string, any>) => log('warn', source, message, data),
        error: (message: string, data?: Record<string, any>, error?: Error) => log('error', source, message, data, error),

        // Timer utility for measuring duration
        startTimer: () => {
            const start = Date.now();
            return {
                end: (message: string, data?: Record<string, any>) => {
                    const duration = Date.now() - start;
                    log('info', source, message, { ...data, durationMs: duration });
                    return duration;
                }
            };
        }
    };
}

// Pre-configured loggers
export const aiGradingLogger = createLogger('ai-grading');
export const worksheetLogger = createLogger('worksheet');
export const apiLogger = createLogger('api');
