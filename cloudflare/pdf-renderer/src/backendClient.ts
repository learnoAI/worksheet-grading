interface Env {
    WORKSHEET_CREATION_BACKEND_BASE_URL: string;
    WORKSHEET_CREATION_WORKER_TOKEN: string;
}

interface WorksheetData {
    id: string;
    studentId: string;
    batchId: string | null;
    sectionsJson: any;
}

export class BackendClient {
    private readonly baseUrl: string;
    private readonly token: string;

    constructor(env: Env) {
        this.baseUrl = env.WORKSHEET_CREATION_BACKEND_BASE_URL.replace(/\/$/, '');
        this.token = env.WORKSHEET_CREATION_WORKER_TOKEN;
    }

    async getWorksheetData(worksheetId: string): Promise<WorksheetData> {
        const res = await fetch(
            `${this.baseUrl}/internal/worksheet-generation/${worksheetId}/data`,
            {
                headers: {
                    'X-Worksheet-Creation-Token': this.token,
                    'Content-Type': 'application/json'
                }
            }
        );
        if (!res.ok) throw new Error(`Failed to fetch worksheet data: ${res.status}`);
        const json = await res.json() as any;
        return json.data;
    }

    async markComplete(worksheetId: string, pdfUrl: string, batchId: string | null): Promise<void> {
        const res = await fetch(
            `${this.baseUrl}/internal/worksheet-generation/${worksheetId}/complete`,
            {
                method: 'POST',
                headers: {
                    'X-Worksheet-Creation-Token': this.token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ pdfUrl, batchId })
            }
        );
        if (!res.ok) throw new Error(`Failed to mark complete: ${res.status}`);
    }

    async markFailed(worksheetId: string, error: string, batchId: string | null): Promise<void> {
        const res = await fetch(
            `${this.baseUrl}/internal/worksheet-generation/${worksheetId}/fail`,
            {
                method: 'POST',
                headers: {
                    'X-Worksheet-Creation-Token': this.token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ error, batchId })
            }
        );
        if (!res.ok) console.error(`Failed to mark failed: ${res.status}`);
    }
}
