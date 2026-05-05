import { MongoClient, Collection } from 'mongodb';

interface ErrorLog {
    timestamp: Date;
    source: string;
    error: string;
    stack?: string;
    payload?: Record<string, any>;
}

let collection: Collection<ErrorLog> | null = null;
let lastConnectionAttemptAt = 0;
let connectFailureCount = 0;
let insertFailureCount = 0;

const CONNECTION_RETRY_MS = 60_000;

export function getErrorLogConnectFailureCount(): number {
    return connectFailureCount;
}

export function getErrorLogInsertFailureCount(): number {
    return insertFailureCount;
}

async function getCollection(): Promise<Collection<ErrorLog> | null> {
    if (collection) return collection;
    if (Date.now() - lastConnectionAttemptAt < CONNECTION_RETRY_MS) return null;

    lastConnectionAttemptAt = Date.now();
    const mongoUrl = process.env.MONGO_URL;
    if (!mongoUrl) return null;

    try {
        const client = new MongoClient(mongoUrl);
        await client.connect();
        collection = client.db().collection<ErrorLog>('error_logs');
        connectFailureCount = 0;
        return collection;
    } catch (connectErr) {
        connectFailureCount += 1;
        // Rate-limit so a flapping connection doesn't flood the log stream:
        // first failure plus every 100th. The collection went silent for
        // 10+ days under prod load with the previous swallow-everything
        // handler, so even infrequent surfacing is a meaningful upgrade.
        if (connectFailureCount === 1 || connectFailureCount % 100 === 0) {
            const message = connectErr instanceof Error ? connectErr.message : String(connectErr);
            console.error('[errorLogService] mongo_connect_failed', { message, connectFailureCount });
        }
        return null;
    }
}

export async function logError(source: string, error: Error | string, payload?: Record<string, any>): Promise<void> {
    const col = await getCollection();
    const errorObj = error instanceof Error ? error : new Error(error);

    const doc: ErrorLog = {
        timestamp: new Date(),
        source,
        error: errorObj.message,
        stack: errorObj.stack,
        payload
    };

    if (col) {
        try {
            await col.insertOne(doc);
        } catch (insertErr) {
            insertFailureCount += 1;
            if (insertFailureCount === 1 || insertFailureCount % 100 === 0) {
                const message = insertErr instanceof Error ? insertErr.message : String(insertErr);
                console.error('[errorLogService] mongo_insert_failed', {
                    source,
                    error: message,
                    insertFailureCount
                });
            }
        }
    }

    console.error(`[${source}]`, errorObj.message, payload);
}
