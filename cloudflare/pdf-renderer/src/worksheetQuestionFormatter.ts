export interface WorksheetQuestion {
    question: string;
    answer?: string;
    renderSpec?: unknown;
}

interface SectionContext {
    skillName: string;
    instruction: string;
}

type QuestionRenderSpec =
    | { kind: 'long_division'; divisor: string; dividend: string }
    | { kind: 'vertical_arithmetic'; operator: string; operands: string[]; answerLines?: number }
    | { kind: 'choice_circle'; options: string[]; prompt?: string }
    | { kind: 'plain'; text?: string };

const NUMBER_PATTERN = '-?\\d+(?:,\\d{2,3})*(?:\\.\\d+)?';
const divisionPattern = new RegExp(`^(${NUMBER_PATTERN})\\s*\\)\\s*(${NUMBER_PATTERN})\\s*(?:=)?$`);
const arithmeticPattern = new RegExp(`^(${NUMBER_PATTERN})\\s*([+\\-\\u2212xX\\u00d7*])\\s*(${NUMBER_PATTERN})\\s*(?:=)?$`);
const numberPattern = new RegExp(NUMBER_PATTERN, 'g');

export const WORKSHEET_QUESTION_STYLES = `
    .worksheet-grid {
        display: grid;
        gap: 8px 16px;
        margin-top: 12px;
    }

    .worksheet-cell {
        box-sizing: border-box;
        min-height: 88px;
        padding: 4px 0;
        break-inside: avoid;
    }

    .worksheet-question {
        color: #000;
        display: flex;
        font-family: Arial, Helvetica, sans-serif;
        font-variant-numeric: tabular-nums;
        font-weight: 400;
        letter-spacing: 0;
    }

    .worksheet-question__label {
        flex: 0 0 auto;
        font-size: 18px;
        line-height: 1;
        white-space: nowrap;
    }

    .worksheet-question--plain {
        align-items: flex-start;
        gap: 6px;
    }

    .worksheet-question__plain-text {
        font-size: 18px;
        line-height: 1.25;
        overflow-wrap: anywhere;
    }

    .worksheet-question--division {
        align-items: flex-end;
        gap: 14px;
        padding-top: 12px;
    }

    .worksheet-question--division .worksheet-question__label {
        padding-bottom: 3px;
    }

    .long-division {
        align-items: flex-end;
        display: inline-flex;
        font-size: 24px;
        line-height: 1;
        white-space: nowrap;
    }

    .long-division__divisor {
        padding: 0 8px 2px 0;
    }

    .long-division__bracket {
        font-size: 32px;
        line-height: 0.85;
        margin-right: 6px;
        transform: translateY(1px);
    }

    .long-division__dividend {
        border-top: 1px solid #111;
        min-width: 36px;
        padding: 7px 8px 0;
        text-align: center;
    }

    .worksheet-question--vertical {
        align-items: flex-start;
        gap: 12px;
        min-height: 112px;
    }

    .worksheet-question--vertical .worksheet-question__label {
        font-size: 22px;
        padding-top: 44px;
    }

    .vertical-problem {
        font-size: 24px;
        line-height: 1.1;
        margin-left: auto;
        margin-right: 10px;
        min-width: 96px;
    }

    .vertical-problem__row {
        align-items: baseline;
        display: flex;
        justify-content: flex-end;
        min-height: 28px;
    }

    .vertical-problem__operator {
        padding-right: 8px;
        text-align: left;
        width: 22px;
    }

    .vertical-problem__operand {
        min-width: 54px;
        text-align: right;
    }

    .vertical-problem__rule {
        background: #111;
        height: 1px;
        margin-top: 5px;
        width: 100%;
    }

    .vertical-problem__answer-line {
        margin-top: 24px;
    }

    .worksheet-question--choice {
        align-items: baseline;
        gap: 10px;
        padding-top: 14px;
    }

    .choice-circle {
        align-items: baseline;
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
    }

    .choice-circle__prompt {
        font-size: 16px;
        line-height: 1.2;
        width: 100%;
    }

    .choice-circle__option {
        display: inline-flex;
        font-size: 20px;
        justify-content: center;
        min-width: 28px;
        padding: 2px 4px;
    }
`;

export function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderWorksheetQuestion(
    questionNumber: number,
    question: WorksheetQuestion,
    context: SectionContext
): string {
    const questionText = normalizeQuestionText(question.question);
    const renderSpec = normalizeRenderSpec(question.renderSpec) ?? inferRenderSpec(questionText, context);

    if (renderSpec?.kind === 'long_division') {
        return renderLongDivision(questionNumber, renderSpec);
    }

    if (renderSpec?.kind === 'vertical_arithmetic') {
        return renderVerticalArithmetic(questionNumber, renderSpec);
    }

    if (renderSpec?.kind === 'choice_circle') {
        return renderChoiceCircle(questionNumber, renderSpec);
    }

    const text = renderSpec?.kind === 'plain' && renderSpec.text ? renderSpec.text : questionText;
    return renderPlainQuestion(questionNumber, text);
}

function normalizeQuestionText(text: string): string {
    return text.replace(/\s+/g, ' ').trim().replace(/^Q\s*\d+\.?\s*/i, '');
}

function normalizeRenderSpec(value: unknown): QuestionRenderSpec | null {
    if (!value || typeof value !== 'object') return null;

    const spec = value as Record<string, unknown>;
    if (spec.kind === 'long_division' && isNonEmptyString(spec.divisor) && isNonEmptyString(spec.dividend)) {
        return { kind: 'long_division', divisor: spec.divisor, dividend: spec.dividend };
    }

    if (
        spec.kind === 'vertical_arithmetic' &&
        isNonEmptyString(spec.operator) &&
        Array.isArray(spec.operands) &&
        spec.operands.length >= 2 &&
        spec.operands.every(isNonEmptyString)
    ) {
        const answerLines = typeof spec.answerLines === 'number' ? spec.answerLines : undefined;
        return { kind: 'vertical_arithmetic', operator: spec.operator, operands: spec.operands, answerLines };
    }

    if (
        spec.kind === 'choice_circle' &&
        Array.isArray(spec.options) &&
        spec.options.length >= 2 &&
        spec.options.every(isNonEmptyString)
    ) {
        return {
            kind: 'choice_circle',
            options: spec.options,
            prompt: isNonEmptyString(spec.prompt) ? spec.prompt : undefined
        };
    }

    if (spec.kind === 'plain') {
        return { kind: 'plain', text: isNonEmptyString(spec.text) ? spec.text : undefined };
    }

    return null;
}

function inferRenderSpec(questionText: string, context: SectionContext): QuestionRenderSpec | null {
    const divisionMatch = questionText.match(divisionPattern);
    if (divisionMatch) {
        return { kind: 'long_division', divisor: divisionMatch[1], dividend: divisionMatch[2] };
    }

    const arithmeticMatch = questionText.match(arithmeticPattern);
    if (arithmeticMatch) {
        return {
            kind: 'vertical_arithmetic',
            operator: normalizeOperator(arithmeticMatch[2]),
            operands: [arithmeticMatch[1], arithmeticMatch[3]]
        };
    }

    const contextText = `${context.skillName} ${context.instruction}`.toLowerCase();
    const isCircleChoiceSkill = /\b(circle|select|choose|smallest|largest|smaller|larger)\b/.test(contextText);
    if (isCircleChoiceSkill) {
        const options = questionText.match(numberPattern);
        if (options && options.length >= 2) {
            return { kind: 'choice_circle', options };
        }
    }

    return null;
}

function renderLongDivision(questionNumber: number, spec: Extract<QuestionRenderSpec, { kind: 'long_division' }>): string {
    return `
        <div class="worksheet-question worksheet-question--division">
            ${renderQuestionLabel(questionNumber)}
            <span class="long-division" aria-label="${escapeHtml(spec.divisor)} divides ${escapeHtml(spec.dividend)}">
                <span class="long-division__divisor">${escapeHtml(spec.divisor)}</span>
                <span class="long-division__bracket">)</span>
                <span class="long-division__dividend">${escapeHtml(spec.dividend)}</span>
            </span>
        </div>
    `;
}

function renderVerticalArithmetic(
    questionNumber: number,
    spec: Extract<QuestionRenderSpec, { kind: 'vertical_arithmetic' }>
): string {
    const operands = spec.operands.slice(0, 3);
    const operator = normalizeOperator(spec.operator);
    const answerLines = Math.max(1, Math.min(3, spec.answerLines ?? 2));
    const rows = operands.map((operand, index) => {
        const op = index === operands.length - 1 ? operator : '';
        return `
            <div class="vertical-problem__row">
                <span class="vertical-problem__operator">${escapeHtml(op)}</span>
                <span class="vertical-problem__operand">${escapeHtml(operand)}</span>
            </div>
        `;
    }).join('');
    const lines = Array.from({ length: answerLines }, (_, index) => {
        const className = index === 0 ? 'vertical-problem__rule' : 'vertical-problem__rule vertical-problem__answer-line';
        return `<div class="${className}"></div>`;
    }).join('');

    return `
        <div class="worksheet-question worksheet-question--vertical">
            ${renderQuestionLabel(questionNumber)}
            <span class="vertical-problem">
                ${rows}
                ${lines}
            </span>
        </div>
    `;
}

function renderChoiceCircle(questionNumber: number, spec: Extract<QuestionRenderSpec, { kind: 'choice_circle' }>): string {
    const prompt = spec.prompt ? `<span class="choice-circle__prompt">${escapeHtml(spec.prompt)}</span>` : '';
    const options = spec.options.map(option => `<span class="choice-circle__option">${escapeHtml(option)}</span>`).join('');

    return `
        <div class="worksheet-question worksheet-question--choice">
            ${renderQuestionLabel(questionNumber)}
            <span class="choice-circle">
                ${prompt}
                ${options}
            </span>
        </div>
    `;
}

function renderPlainQuestion(questionNumber: number, text: string): string {
    return `
        <div class="worksheet-question worksheet-question--plain">
            ${renderQuestionLabel(questionNumber)}
            <span class="worksheet-question__plain-text">${escapeHtml(text)}</span>
        </div>
    `;
}

function renderQuestionLabel(questionNumber: number): string {
    return `<span class="worksheet-question__label">Q${questionNumber}.</span>`;
}

function normalizeOperator(operator: string): string {
    if (operator === '*' || operator.toLowerCase() === 'x' || operator === '\u00d7') return 'x';
    if (operator === '\u2212') return '-';
    return operator;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}
