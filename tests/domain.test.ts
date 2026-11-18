import { describe, it, expect } from "vitest";
import {
  rational as r,
  parseRational,
  add,
  divide,
  equal,
  solve,
  verify,
  transform,
} from "../src/domain/math";
import {
  boardAt,
  sceneAt,
  timelineSchema,
  planSchema,
} from "../src/domain/lesson";
import { example } from "../src/content/example";
describe("exact algebra", () => {
  it("normalizes and adds rational values exactly", () => {
    expect(r(2, -4)).toEqual(r(-1, 2));
    expect(add(r(1, 3), r(1, 6))).toEqual(r(1, 2));
    expect(equal(r(1, 3), r(2, 6))).toBe(true);
    expect(parseRational("8/2")).toEqual(r(4));
  });
  it("solves, transforms and substitutes", () => {
    const e = { a: r(2), b: r(3), c: r(11) };
    const result = solve(e);
    expect(result.kind).toBe("unique");
    if (result.kind === "unique") {
      expect(result.solution).toEqual(r(4));
      expect(result.verified).toBe(true);
      expect(result.steps[1]).toEqual({ a: r(2), b: r(0), c: r(8) });
    }
    expect(verify(e, r(3))).toBe(false);
  });
  it("supports negative and fractional coefficients", () => {
    const e = { a: r(-2, 3), b: r(1, 2), c: r(5, 6) };
    expect(solve(e)).toMatchObject({
      kind: "unique",
      solution: r(-1, 2),
      verified: true,
    });
  });
  it("classifies degenerate equations", () => {
    expect(solve({ a: r(0), b: r(2), c: r(2) }).kind).toBe("infinite");
    expect(solve({ a: r(0), b: r(2), c: r(3) }).kind).toBe("none");
  });
  it("rejects division by zero and untrusted syntax", () => {
    expect(() => divide(r(1), r(0))).toThrow();
    expect(() => parseRational("1/0")).toThrow();
    expect(() => parseRational("1+3")).toThrow();
    expect(() =>
      transform(example.plan.equation, { kind: "divide", value: r(0) }),
    ).toThrow();
  });
  it("verifies practice using substitution", () => {
    expect(verify(example.plan.practice.equation, parseRational("12/3"))).toBe(
      true,
    );
    expect(verify(example.plan.practice.equation, r(5))).toBe(false);
  });
});
describe("continuous teaching", () => {
  const at = (beat: number, offset = 0) => example.scenes[beat].start + offset;
  it("begins uncluttered and retains original working", () => {
    expect(boardAt(example, 0)["original-x"].opacity).toBe(0);
    expect(boardAt(example, at(6))["original-x"].opacity).toBe(1);
  });
  it("progressively reveals matching subtraction", () => {
    const s = boardAt(example, at(6, 0.35));
    expect(s["subtract-left"].opacity).toBeCloseTo(0.5);
    expect(s["subtract-right"].opacity).toBeGreaterThan(0);
    expect(s["subtract-right"].opacity).toBeLessThan(1);
  });
  it("draws partial cancellation strokes", () => {
    expect(boardAt(example, at(8, 0.6))["cancel-plus"].progress).toBeCloseTo(
      0.5,
    );
  });
  it("removes individual blocks halfway, restores them on backward seek", () => {
    const initial = example.plan.elements.find((e) => e.id === "left-0")!;
    const mid = boardAt(example, at(10, 0.9))["left-0"];
    expect(mid.y).toBeCloseTo(initial.y + 32.5);
    expect(mid.opacity).toBeCloseTo(0.5);
    expect(boardAt(example, at(9))["left-0"].opacity).toBe(1);
    expect(boardAt(example, at(9))["left-0"].y).toBe(initial.y);
  });
  it("draws fraction bars and moves groups continuously", () => {
    expect(boardAt(example, at(12, 0.5))["bar-left"].progress).toBeCloseTo(0.5);
    const q = example.scenes[14].cues.find(
      (q) => q.action.target === "right-0",
    )!;
    const mid = boardAt(example, q.at + 1)["right-0"];
    expect(mid.x).toBeCloseTo((q.action.from!.x + q.action.to!.x) / 2);
    expect(boardAt(example, q.at + 1)).toEqual(boardAt(example, q.at + 1));
  });
  it("reveals answer before substitution and verification", () => {
    expect(boardAt(example, at(16))["answer"].opacity).toBe(1);
    expect(boardAt(example, at(16))["verified"].opacity).toBe(0);
    expect(boardAt(example, example.audio.duration)["verified"].opacity).toBe(
      1,
    );
    expect(sceneAt(example, example.audio.duration)).toBe(19);
  });
  it("validates prepared fixtures and rejects unknown targets", () => {
    expect(timelineSchema.safeParse(example).success).toBe(true);
    const plan = structuredClone(example.plan);
    plan.scenes[0].actions[0].target = "unknown";
    expect(planSchema.safeParse(plan).success).toBe(false);
  });
});
