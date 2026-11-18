import { z } from "zod";
const integer = z.string().regex(/^-?\d{1,30}$/);
export const rationalSchema = z.object({
  n: integer,
  d: integer.refine((v) => BigInt(v) !== 0n, "Denominator cannot be zero"),
}).strict();
export type Rational = z.infer<typeof rationalSchema>;
const gcd = (a: bigint, b: bigint): bigint =>
  b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b);
export function rational(n: bigint | number, d: bigint | number = 1): Rational {
  for (const value of [n, d])
    if (typeof value === 'number' && !Number.isSafeInteger(value))
      throw new Error('Exact arithmetic requires safe integers or BigInt values');
  let a = BigInt(n),
    b = BigInt(d);
  if (!b) throw new Error("Division by zero");
  const g = gcd(a, b);
  if (b < 0n) {
    a = -a;
    b = -b;
  }
  return { n: String(a / g), d: String(b / g) };
}
export function parseRational(input: string): Rational {
  const m = /^\s*([+-]?\d{1,30})(?:\s*\/\s*([+-]?\d{1,30}))?\s*$/.exec(input.replaceAll("−", "-"));
  if (!m) throw new Error("Enter an integer or fraction, such as 4 or 8/2.");
  return rational(BigInt(m[1]), BigInt(m[2] ?? "1"));
}
export const add = (a: Rational, b: Rational) =>
  rational(
    BigInt(a.n) * BigInt(b.d) + BigInt(b.n) * BigInt(a.d),
    BigInt(a.d) * BigInt(b.d),
  );
export const negate = (a: Rational) => rational(-BigInt(a.n), BigInt(a.d));
export const multiply = (a: Rational, b: Rational) =>
  rational(BigInt(a.n) * BigInt(b.n), BigInt(a.d) * BigInt(b.d));
export function divide(a: Rational, b: Rational) {
  if (BigInt(b.n) === 0n) throw new Error("Division by zero");
  return rational(BigInt(a.n) * BigInt(b.d), BigInt(a.d) * BigInt(b.n));
}
export const equal = (a: Rational, b: Rational) =>
  BigInt(a.n) * BigInt(b.d) === BigInt(b.n) * BigInt(a.d);
export const equationSchema = z.object({
  a: rationalSchema,
  b: rationalSchema,
  c: rationalSchema,
}).strict();
export function normalizeEquation(input: Equation): Equation {
  const e = equationSchema.parse(input);
  return {a:rational(BigInt(e.a.n),BigInt(e.a.d)),b:rational(BigInt(e.b.n),BigInt(e.b.d)),c:rational(BigInt(e.c.n),BigInt(e.c.d))};
}
export type Equation = z.infer<typeof equationSchema>;
export const operationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add"), value: rationalSchema }),
  z.object({
    kind: z.literal("divide"),
    value: rationalSchema.refine(
      (v) => BigInt(v.n) !== 0n,
      "Cannot divide by zero",
    ),
  }),
]);
export function transform(
  input: Equation,
  operation: z.infer<typeof operationSchema>,
): Equation {
  const e = normalizeEquation(input),
    o = operationSchema.parse(operation);
  return o.kind === "add"
    ? { a: e.a, b: add(e.b, o.value), c: add(e.c, o.value) }
    : {
        a: divide(e.a, o.value),
        b: divide(e.b, o.value),
        c: divide(e.c, o.value),
      };
}
export function verify(input: Equation, x: Rational) {
  const e = equationSchema.parse(input);
  rationalSchema.parse(x);
  return equal(add(multiply(e.a, x), e.b), e.c);
}
export function solve(input: Equation) {
  const e = normalizeEquation(input);
  if (BigInt(e.a.n) === 0n)
    return { kind: equal(e.b, e.c) ? "infinite" : "none" } as const;
  const isolated = transform(e, { kind: "add", value: negate(e.b) });
  const final = transform(isolated, { kind: "divide", value: e.a });
  return {
    kind: "unique",
    solution: final.c,
    steps: [e, isolated, final],
    verified: verify(e, final.c),
  } as const;
}
