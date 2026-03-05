import puppeteer from 'puppeteer';
import prisma from '../utils/prisma';
import { uploadToS3 } from './s3Service';

interface SectionData {
    skillId: string;
    skillName: string;
    instruction: string;
    questions: { question: string; answer: string }[];
}

function buildPageHtml(sections: [SectionData, SectionData], pageStartQ: number): string {
    const [sectionTop, sectionBottom] = sections;

    const renderGrid = (questions: { question: string }[], startNum: number) => {
        const cols = 4;
        const rows = Math.ceil(questions.length / cols);
        let html = '<div style="display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(' + rows + ',1fr);gap:8px 16px;margin-top:12px;">';
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const idx = c * rows + r; // column-major order (Q1-5 in col 1, Q6-10 in col 2, etc.)
                const q = questions[idx];
                const num = startNum + idx;
                if (q) {
                    html += `<div style="font-size:14px;padding:4px 0;min-height:60px;border-left:${c > 0 ? '1px solid #ccc' : 'none'};padding-left:${c > 0 ? '12px' : '0'};">Q${num}. ${escapeHtml(q.question)}</div>`;
                } else {
                    html += '<div></div>';
                }
            }
        }
        html += '</div>';
        return html;
    };

    return `
        <div style="border:3px solid #888;border-radius:4px;padding:20px 24px;height:100%;box-sizing:border-box;display:flex;flex-direction:column;">
            <div style="display:flex;justify-content:space-between;font-size:13px;border-bottom:1px solid #aaa;padding-bottom:8px;margin-bottom:4px;">
                <span>Name:________________</span>
                <span>Token Number:________</span>
                <span>Marks:______</span>
            </div>

            <div style="flex:1;display:flex;flex-direction:column;">
                <div style="flex:1;">
                    <div style="font-size:13px;font-weight:bold;margin-top:12px;white-space:pre-line;">${escapeHtml(sectionTop.instruction)}</div>
                    ${renderGrid(sectionTop.questions, pageStartQ)}
                </div>

                <div style="border-top:2px solid #aaa;margin:12px 0;"></div>

                <div style="flex:1;">
                    <div style="font-size:13px;font-weight:bold;white-space:pre-line;">${escapeHtml(sectionBottom.instruction)}</div>
                    ${renderGrid(sectionBottom.questions, pageStartQ + 10)}
                </div>
            </div>

            <div style="text-align:right;margin-top:8px;font-size:18px;font-weight:bold;color:#444;">
                Saarthi<br/><span style="font-size:10px;font-weight:normal;letter-spacing:2px;">EDUCATION</span>
            </div>
        </div>
    `;
}

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildFullHtml(sections: SectionData[]): string {
    const page1 = buildPageHtml([sections[0], sections[1]], 1);
    const page2 = buildPageHtml([sections[2], sections[3]], 21);

    return `<!DOCTYPE html>
<html>
<head>
<style>
    @page { size: A4; margin: 10mm; }
    body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 0; }
    .page { width: 100%; height: 100vh; page-break-after: always; }
    .page:last-child { page-break-after: auto; }
</style>
</head>
<body>
    <div class="page">${page1}</div>
    <div class="page">${page2}</div>
</body>
</html>`;
}

/**
 * Render a GeneratedWorksheet to PDF, upload to S3/R2, update DB record.
 */
export async function renderWorksheetPdf(worksheetId: string): Promise<string> {
    const ws = await prisma.generatedWorksheet.findUnique({ where: { id: worksheetId } });
    if (!ws) throw new Error(`Worksheet ${worksheetId} not found`);

    const sections = ws.sectionsJson as unknown as SectionData[];
    if (!sections || sections.length !== 4) throw new Error('Invalid sections data');

    await prisma.generatedWorksheet.update({
        where: { id: worksheetId },
        data: { status: 'RENDERING' }
    });

    try {
        const html = buildFullHtml(sections);

        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
        });

        await browser.close();

        // Upload to S3/R2
        const key = `generated-worksheets/${ws.studentId}/${worksheetId}.pdf`;
        const pdfUrl = await uploadToS3(Buffer.from(pdfBuffer), key, 'application/pdf');

        await prisma.generatedWorksheet.update({
            where: { id: worksheetId },
            data: { pdfUrl, status: 'COMPLETED' }
        });

        return pdfUrl;
    } catch (err) {
        await prisma.generatedWorksheet.update({
            where: { id: worksheetId },
            data: { status: 'FAILED' }
        });
        throw err;
    }
}

/**
 * Render all worksheets in a batch.
 */
export async function renderBatchPdfs(worksheetIds: string[]): Promise<void> {
    for (const id of worksheetIds) {
        try {
            await renderWorksheetPdf(id);
        } catch (err) {
            console.error(`[pdf] render failed for ${id}:`, err);
        }
    }
}
