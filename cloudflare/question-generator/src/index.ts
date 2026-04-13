import { z } from 'zod';

interface Env {
    WORKSHEET_CREATION_WORKER_TOKEN: string;
    WORKSHEET_CREATION_BACKEND_BASE_URL: string;
    GEMINI_API_KEY: string;
    GEMINI_MODEL?: string;
}

const RequestSchema = z.object({
    mathSkillId: z.string(),
    skillName: z.string(),
    topicName: z.string(),
    count: z.number().int().min(1).max(50).default(30)
});

const QuestionSchema = z.object({
    question: z.string(),
    answer: z.string(),
    instruction: z.string()
});

interface QueueMessageV1 {
    v: 1;
    mathSkillId: string;
    skillName: string;
    topicName: string;
    count: number;
    batchId: string;
    enqueuedAt: string;
}

async function generateQuestions(
    env: Env,
    skillName: string,
    topicName: string,
    count: number
): Promise<z.infer<typeof QuestionSchema>[]> {
    const model = env.GEMINI_MODEL || 'gemini-2.0-flash';
    const prompt = `You are a math worksheet question generator for elementary school students in India.

Topic: ${topicName}
Skill: ${skillName}

Generate exactly ${count} unique math questions for this skill. Each question must be appropriate for the skill level described.

Rules:
- Questions must be computational (not word problems unless the skill requires it)
- Provide the correct numerical answer for each question
- Provide a short instruction line in English and Hindi (e.g., "Add the following.\\nजोड़ करो।")
- All ${count} questions must test the SAME skill but with different numbers
- Keep question text concise (how it would appear on a worksheet)
- For division, use the format: "divisor ) dividend" (e.g., "3 ) 24")
- For vertical operations, just show the horizontal form (e.g., "145 + 37")

Return a JSON array of objects with fields: question, answer, instruction
Return ONLY the JSON array, no other text.`;

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.8,
                    responseMimeType: 'application/json'
                }
            })
        }
    );

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Gemini API error ${response.status}: ${text}`);
    }

    const data = await response.json() as any;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty response from Gemini');

    const parsed = JSON.parse(text);
    return z.array(QuestionSchema).parse(parsed);
}

async function storeQuestionsOnBackend(
    env: Env,
    mathSkillId: string,
    questions: z.infer<typeof QuestionSchema>[],
    batchId: string
): Promise<void> {
    const res = await fetch(
        `${env.WORKSHEET_CREATION_BACKEND_BASE_URL}/internal/question-bank/store`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Worksheet-Creation-Token': env.WORKSHEET_CREATION_WORKER_TOKEN
            },
            body: JSON.stringify({ mathSkillId, questions, batchId })
        }
    );
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Backend store failed: ${res.status} ${text}`);
    }
}

export default {
    // HTTP handler — synchronous single-student flow (dev/small batches)
    async fetch(request: Request, env: Env): Promise<Response> {
        if (request.method !== 'POST') {
            return new Response('Method not allowed', { status: 405 });
        }

        const token = request.headers.get('X-Worksheet-Creation-Token');
        if (!token || token !== env.WORKSHEET_CREATION_WORKER_TOKEN) {
            return new Response('Unauthorized', { status: 401 });
        }

        try {
            const body = await request.json();
            const input = RequestSchema.parse(body);
            const questions = await generateQuestions(env, input.skillName, input.topicName, input.count);

            return Response.json({
                success: true,
                mathSkillId: input.mathSkillId,
                questions
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error('Question generation failed:', message);
            return Response.json({ success: false, error: message }, { status: 500 });
        }
    },

    // Queue handler — async batch flow
    async queue(batch: any, env: Env): Promise<void> {
        const messages = (batch.messages || []) as any[];

        for (const message of messages) {
            try {
                const body = typeof message.body === 'string' ? JSON.parse(message.body) : message.body;
                const msg = body as QueueMessageV1;

                if (msg.v !== 1 || !msg.mathSkillId || !msg.skillName) {
                    console.error('Invalid queue message:', JSON.stringify(body));
                    message.ack();
                    continue;
                }

                const questions = await generateQuestions(env, msg.skillName, msg.topicName, msg.count);

                await storeQuestionsOnBackend(env, msg.mathSkillId, questions, msg.batchId);

                message.ack();
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                console.error('Queue message processing failed:', errorMsg);

                if (errorMsg.includes('429') || errorMsg.includes('503') || errorMsg.includes('500')) {
                    message.retry();
                } else {
                    console.error('Non-retryable error, dropping message');
                    message.ack();
                }
            }
        }
    }
};
