import { MongoClient, Collection } from 'mongodb';

interface ErrorLog {
    timestamp: Date;
    source: string;
    error: string;
    stack?: string;
    payload?: Record<string, any>;
}

let collection: Collection<ErrorLog> | null = null;
let connectionAttempted = false;

async function getCollection(): Promise<Collection<ErrorLog> | null> {
    if (collection) return collection;
    if (connectionAttempted) return null;

    connectionAttempted = true;
    const mongoUrl = process.env.MONGO_URL;
    if (!mongoUrl) return null;

    try {
        const client = new MongoClient(mongoUrl);
        await client.connect();
        collection = client.db().collection<ErrorLog>('error_logs');
        return collection;
    } catch {
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
        await col.insertOne(doc).catch(() => { });
    }

    console.error(`[${source}]`, errorObj.message, payload);
}
