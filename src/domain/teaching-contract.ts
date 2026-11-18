import { z } from 'zod';
export const LESSON_PIPELINE_VERSION = 4;
export const NARRATION_LIMIT = 179;
export const EXPLANATION_LIMITS = { min: 4, max: 90 } as const;
export const QUALITATIVE_PHRASES = ['one side', 'one term', 'one unknown', 'two sides'] as const;
const numberWords = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|half|halves|quarter|quarters|thirds?|fourths?|fifths?|sixths?|sevenths?|eighths?|ninths?|tenths?|twelfths?)\b/i;
export function unsupportedNumberWords(text: string) {
  const prose = text.replace(new RegExp(`\\b(?:${QUALITATIVE_PHRASES.join('|')})\\b`, 'gi'), 'reference');
  return numberWords.test(prose);
}
export const EXPLANATION_RULES = {
  length: `Use ${EXPLANATION_LIMITS.min}–${EXPLANATION_LIMITS.max} characters after trimming whitespace.`,
  text: 'Use ordinary prose only; no digits, mathematical symbols, markup or code.',
  numbers: `Keep numerical values in code-supplied facts. Allowed qualitative phrases: ${QUALITATIVE_PHRASES.join(', ')}.`,
  equality: 'Explain matching operations on both sides; do not instruct changing only one side or ignoring equality.',
} as const;
export const EXPLANATION_STYLE = [
  `Write short qualitative reasons, ${EXPLANATION_LIMITS.min}–${EXPLANATION_LIMITS.max} characters after surrounding whitespace is trimmed.`,
  `You may use these exact qualitative phrases: ${QUALITATIVE_PHRASES.join(', ')}.`,
  'Otherwise omit number words and all digits, arithmetic claims, equations, symbols, markup, code and URLs.',
  'Use ordinary sentences explaining why the verified operation preserves equality; application code supplies all equation-specific values, signs, fractions and answers.',
  'Do not instruct changing only one side, using different operations on opposite sides, or ignoring equality.',
  'Do not repeat the trusted mathematical facts. The compiler may omit an optional prose sentence if the complete speech beat would exceed its limit.',
].join(' ');
export const PROSE_LIMITS = { objective: {min:10,max:140}, outline: {min:3,max:90} } as const;
const lengthRule = (min:number,max:number) => `Use ${min}–${max} characters after trimming whitespace.`;
export function qualitativeTextSchema(min:number,max:number) {
  return z.string().trim().min(min,lengthRule(min,max)).max(max,lengthRule(min,max)).superRefine((text,ctx) => {
  if (!/^[\p{L}\s,.;:"'‘’“”!?()\-–—]+$/u.test(text) || /\b(?:javascript|eval|html|svg|script)\b/i.test(text) || /\b[A-Za-z_$][\w$]*\(/.test(text))
    ctx.addIssue({ code: 'custom', message: EXPLANATION_RULES.text });
  if (unsupportedNumberWords(text)) ctx.addIssue({ code: 'custom', message: EXPLANATION_RULES.numbers });
  if (/\b(?:only (?:the )?(?:left|right)|different operations|ignore equality|break equality|(?:change|modify|alter|adjust) only one side)\b/i.test(text))
    ctx.addIssue({ code: 'custom', message: EXPLANATION_RULES.equality });
  }).describe('Use ordinary qualitative prose without numeric claims, markup or code. Allowed phrases: ' + QUALITATIVE_PHRASES.join(', '));
}
export const explanationSchema = qualitativeTextSchema(EXPLANATION_LIMITS.min,EXPLANATION_LIMITS.max).describe(EXPLANATION_STYLE);
export const objectiveSchema = qualitativeTextSchema(PROSE_LIMITS.objective.min,PROSE_LIMITS.objective.max);
export const outlineItemSchema = qualitativeTextSchema(PROSE_LIMITS.outline.min,PROSE_LIMITS.outline.max);
/** Only fixed rule text and known field paths may leave the trust boundary. */
export function validationFeedback(error: unknown): string {
  if (!(error instanceof z.ZodError)) return 'response: Return a complete valid lesson object; verified mathematics must remain unchanged.';
  const safe = error.issues.slice(0, 3).map(issue => {
    const parts = issue.path.map(String);
    const known = new Set(['objective','outline','explanations','practice','a','b','c','n','d','equation','solution','beats','id','role','visual','explanation',
      'introduce','unknown','constant','equality','operationLeft','operationRight','cancel','simplify','divideLeft','divideRight','quotient','substitute','multiply','verify']);
    const path = parts.every(p => known.has(p) || /^\d{1,2}$/.test(p)) ? parts.join('.') || 'response' : 'response';
    const fixed = [...Object.values(EXPLANATION_RULES), ...Object.values(PROSE_LIMITS).map(limits=>lengthRule(limits.min,limits.max))].find(rule => rule === issue.message);
    const rule = fixed ?? (parts[0] === 'practice' ? 'Provide valid nonzero-coefficient rational practice data within scope.' : 'Provide the required bounded field with the correct type and structure.');
    return `${path}: ${rule}`;
  });
  return [...new Set(safe)].join(' ');
}
