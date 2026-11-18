import { rational, negate, type Equation, type Rational } from './math';
export const LINEAR_LIMITS = { numerator: 99, denominator: 12, input: 400, digits: 30 } as const;
export const COEFFICIENT_SCOPE = 'Use reduced coefficient numerators up to ninety-nine in magnitude and positive denominators up to twelve.';
export function checkCoefficientBounds(e: Equation) {
  for (const v of Object.values(e))
    if (BigInt(v.n) > BigInt(LINEAR_LIMITS.numerator) || BigInt(v.n) < -BigInt(LINEAR_LIMITS.numerator) || BigInt(v.d) < 1n || BigInt(v.d) > BigInt(LINEAR_LIMITS.denominator))
      throw new Error(COEFFICIENT_SCOPE);
  return e;
}
export type EquationRequest =
  | { kind: 'topic' }
  | { kind: 'invalid'; message: string }
  | { kind: 'equation'; equation: Equation; context: { prefix: string; suffix: string } };
const syntax = 'Write one equation ax + b = c using signed integers or fractions, for example (1/2)x + 3 = 7. Decimals, variable denominators, powers and variables on both sides are unsupported.';
/** Deliberately small grammar. Only recognised prose wrappers are removed; the
 * ENTIRE remaining mathematical input must parse. There is no substring search. */
export function parseEquationRequest(input: string): EquationRequest {
  if (input.length > LINEAR_LIMITS.input) return { kind: 'invalid', message: 'Keep the request within 400 characters.' };
  let text = input.trim().replaceAll('−', '-').replaceAll('×', '*');
  if (!/[=^/*()]|\bx\b|\d\s*x/i.test(text)) return { kind: 'topic' };
  const wrapper = /^(?:(?:please\s+)?(?:(?:can|could)\s+you\s+)?(?:help\s+me\s+(?:to\s+)?(?:solve|understand)|teach\s+me\s+(?:how\s+to\s+solve|to\s+solve)|teach\s+me|show\s+me\s+how\s+to\s+solve|explain|solve|teach)\s+(?:the\s+equation\s*)?:?\s*)/i.exec(text);
  const prefix = wrapper?.[0] ?? '';
  text = text.slice(prefix.length).trim();
  text = text.replace(/[.!?]+$/, '').trim();
  const suffix = /\s+(?:step\s+by\s+step|please)$/i.exec(text)?.[0] ?? '';
  text = text.slice(0, text.length - suffix.length).trim();
  try {
    const tokens: string[] = [];
    for (let i = 0; i < text.length;) {
      if (/\s/.test(text[i])) { i++; continue; }
      const m = /^(?:\d+|x|[+\-/*()=])/i.exec(text.slice(i));
      if (!m || /^\d/.test(m[0]) && m[0].length > LINEAR_LIMITS.digits) throw new Error(syntax);
      tokens.push(m[0].toLowerCase()); i += m[0].length;
    }
    let cursor = 0;
    const peek = () => tokens[cursor];
    const take = (value: string) => { if (peek() !== value) throw new Error(syntax); cursor++; };
    const sign = () => { const s = peek(); if (s === '-' || s === '+') cursor++; return s === '-' ? -1n : 1n; };
    function integer() { const s = sign(), value = peek(); if (!value || !/^\d+$/.test(value)) throw new Error(syntax); cursor++; return s * BigInt(value); }
    function fraction(): Rational {
      const n = integer(); let d = 1n;
      if (peek() === '/') { cursor++; d = integer(); }
      return rational(n, d);
    }
    function scalar(): Rational {
      // Parentheses are only a scalar wrapper, never a general expression.
      let leading = 1n;
      if ((peek() === '-' || peek() === '+') && tokens[cursor + 1] === '(') leading = sign();
      if (peek() !== '(') return fraction();
      take('('); const value = fraction(); take(')');
      return leading < 0n ? negate(value) : value;
    }
    let a: Rational;
    if (peek() === 'x' || ['-', '+'].includes(peek()) && tokens[cursor + 1] === 'x') {
      const n = sign(); take('x'); let d = 1n;
      if (peek() === '/') { cursor++; d = integer(); }
      a = rational(n, d);
    } else {
      a = scalar(); if (peek() === '*') cursor++; take('x');
    }
    let b = rational(0);
    if (peek() === '+' || peek() === '-') { const s = sign(); b = scalar(); if (s < 0n) b = negate(b); }
    take('='); const c = scalar();
    if (cursor !== tokens.length) throw new Error(syntax);
    return { kind: 'equation', equation: checkCoefficientBounds({ a, b, c }), context: {
      prefix: prefix.trim().toLowerCase().replace(/\s+/g, ' '), suffix: suffix.trim().toLowerCase().replace(/\s+/g, ' '),
    } };
  } catch (error) {
    return { kind: 'invalid', message: error instanceof Error && error.message === COEFFICIENT_SCOPE
      ? COEFFICIENT_SCOPE : error instanceof Error && error.message === 'Division by zero'
        ? 'A fraction denominator cannot be zero. Please correct the equation.' : syntax };
  }
}
export function specificEquation(input: string): Equation | null {
  const result = parseEquationRequest(input);
  return result.kind === 'equation' ? result.equation : null;
}
