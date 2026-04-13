import { CloudflareQueueClient } from './cloudflareQueueClient';
import config from '../../config/env';

export interface QuestionGenQueueMessage {
    v: 1;
    mathSkillId: string;
    skillName: string;
    topicName: string;
    count: number;
    batchId: string;
    enqueuedAt: string;
}

let cachedClient: CloudflareQueueClient | null = null;

function getQuestionGenQueueClient(): CloudflareQueueClient {
    if (cachedClient) return cachedClient;

    cachedClient = new CloudflareQueueClient({
        accountId: config.cloudflare.accountId,
        queueId: config.worksheetGeneration.questionQueueId,
        apiToken: config.cloudflare.apiToken,
        consumerName: 'question-generator',
        apiBaseUrl: config.cloudflare.apiBaseUrl
    });

    return cachedClient;
}

export function createQuestionGenMessage(
    mathSkillId: string,
    skillName: string,
    topicName: string,
    count: number,
    batchId: string
): QuestionGenQueueMessage {
    return {
        v: 1,
        mathSkillId,
        skillName,
        topicName,
        count,
        batchId,
        enqueuedAt: new Date().toISOString()
    };
}

export async function enqueueQuestionGeneration(message: QuestionGenQueueMessage): Promise<void> {
    const client = getQuestionGenQueueClient();
    await client.publish(message);
}
