import { negate, rational, type Rational, type Equation } from "./math";
const normalized = (v: Rational) => rational(BigInt(v.n), BigInt(v.d));
export function valueText(input: Rational, latex = false) {
  const v = normalized(input);
  return v.d === "1" ? v.n : latex ? `\\frac{${v.n}}{${v.d}}` : `${v.n}/${v.d}`;
}
export function signedTerm(input: Rational, latex = false) {
  const v = normalized(input),
    negative = BigInt(v.n) < 0n;
  return `${negative ? "-" : "+"}${valueText(negative ? negate(v) : v, latex)}`;
}
export function coefficient(input: Rational, latex = false) {
  const v = normalized(input);
  if (v.n === v.d) return "x";
  if (v.n === `-${v.d}`) return "-x";
  return `${valueText(v, latex)}x`;
}
export function formatEquation(e: Equation, latex = false) {
  const term = signedTerm(e.b, latex);
  return `${coefficient(e.a, latex)} ${term[0]} ${term.slice(1)} = ${valueText(e.c, latex)}`;
}

export function stepLabel(title:string){const labels:Record<string,string>={introduce:'Read the equation',unknown:'Identify the unknown',constant:'Identify the constant',equality:'Keep both sides equal',operationLeft:'Change the left side',operationRight:'Match the right side',cancel:'Cancel opposite terms',simplify:'Simplify the working',divideLeft:'Divide the left side',divideRight:'Divide the right side',quotient:'Simplify the division',solution:'Find the value of x',substitute:'Substitute into the original equation',multiply:'Work out the product',verify:'Check both sides',practice:'Try it yourself'};return labels[title]??title.split(/[.!?]/)[0].slice(0,80);}
