import { rational, type Rational } from './math';
import { NARRATION_LIMIT } from './teaching-contract';
const units = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const tens = ['', '', 'twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
export function integerSpeech(input: bigint): string {
  if (input < 0n) return `negative ${integerSpeech(-input)}`;
  if (input < 20n) return units[Number(input)];
  if (input < 100n) return tens[Number(input / 10n)] + (input % 10n ? ` ${integerSpeech(input % 10n)}` : '');
  if (input < 1000n) return `${integerSpeech(input / 100n)} hundred` + (input % 100n ? ` ${integerSpeech(input % 100n)}` : '');
  if (input < 1000000n) return `${integerSpeech(input / 1000n)} thousand` + (input % 1000n ? ` ${integerSpeech(input % 1000n)}` : '');
  // Bounded lesson intermediates are much smaller; a plain integer is a safe fallback.
  return input.toString();
}
const denominators: Record<string, [string, string]> = {
  '2':['half','halves'],'3':['third','thirds'],'4':['quarter','quarters'],
  '5':['fifth','fifths'],'6':['sixth','sixths'],'7':['seventh','sevenths'],
  '8':['eighth','eighths'],'9':['ninth','ninths'],'10':['tenth','tenths'],
  '11':['eleventh','elevenths'],'12':['twelfth','twelfths'],
};
export function spoken(input: Rational): string {
  const v = rational(BigInt(input.n), BigInt(input.d));
  if (v.d === '1') return integerSpeech(BigInt(v.n));
  const ending = denominators[v.d];
  if (!ending) return `${integerSpeech(BigInt(v.n))} over ${integerSpeech(BigInt(v.d))}`;
  return `${integerSpeech(BigInt(v.n))} ${ending[BigInt(v.n) === 1n || BigInt(v.n) === -1n ? 0 : 1]}`;
}
export function spokenCoefficient(input: Rational): string {
  const v = rational(BigInt(input.n), BigInt(input.d));
  if (v.n === '1' && v.d === '1') return 'x';
  if (v.n === '-1' && v.d === '1') return 'negative x';
  return `${spoken(v)}${v.d === '1' ? ' x' : ' of x'}`;
}
/** Numerical facts are indivisible. Only complete optional prose sentences can
 * be dropped to fit a clip, never a sign, operation, numerator or denominator. */
export function narrationText(fact: string, explanation: string): string {
  if (fact.length > NARRATION_LIMIT) throw new Error('Verified narration exceeds the speech limit; split this teaching beat before requesting speech.');
  let result = fact;
  for (const sentence of explanation.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? []) {
    const part = sentence.trim();
    if ((result + ' ' + part).length > NARRATION_LIMIT) break;
    result += ' ' + part;
  }
  return result;
}
