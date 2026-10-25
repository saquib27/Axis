import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { interpolate } from "./interpolate.ts";
import { AxisError } from "../errors.ts";

const ctx = {
  inputs: { diff: "some diff", pr: 42, nested: { deep: "value" } },
  outputs: { a: { summary: "a summary", score: 0.4, tags: ["x", "y"] } },
};

describe("interpolate", () => {
  test("substitutes a workflow input", () => {
    assert.equal(interpolate("${inputs.diff}", ctx), "some diff");
  });

  test("a lone reference PRESERVES the referenced type", () => {
    assert.equal(interpolate("${inputs.pr}", ctx), 42);
    assert.equal(interpolate("${steps.a.output.score}", ctx), 0.4);
    assert.deepEqual(interpolate("${steps.a.output.tags}", ctx), ["x", "y"]);
  });

  test("a mixed string interpolates as text", () => {
    assert.equal(interpolate("PR #${inputs.pr} review", ctx), "PR #42 review");
  });

  test("reaches into nested paths", () => {
    assert.equal(interpolate("${inputs.nested.deep}", ctx), "value");
  });

  test("walks nested objects and arrays", () => {
    assert.deepEqual(
      interpolate({ a: ["${inputs.diff}", { b: "${steps.a.output.summary}" }] }, ctx),
      { a: ["some diff", { b: "a summary" }] },
    );
  });

  test("a bare output reference returns the whole object", () => {
    assert.deepEqual(interpolate("${steps.a.output}", ctx), ctx.outputs.a);
  });

  test("leaves non-reference values untouched", () => {
    assert.deepEqual(interpolate({ n: 1, b: true, s: "plain" }, ctx), {
      n: 1, b: true, s: "plain",
    });
  });
});

describe("interpolate — refuses to guess", () => {
  const code = (fn: () => unknown, c: string) =>
    assert.throws(fn, (e: unknown) => {
      assert.ok(e instanceof AxisError);
      assert.equal(e.code, c);
      return true;
    });

  test("missing input throws rather than yielding undefined", () => {
    code(() => interpolate("${inputs.nope}", ctx), "MISSING_INPUT");
  });

  test("reference to a step that has not run", () => {
    code(() => interpolate("${steps.ghost.output.x}", ctx), "UNKNOWN_STEP_REF");
  });

  test("missing field on a step that DID run — the dangerous case", () => {
    // This is the one that matters: the step ran, so a naive implementation
    // would hand the provider `undefined` and charge for the call.
    code(() => interpolate("${steps.a.output.absent}", ctx), "MISSING_INPUT");
  });

  test("malformed reference is rejected, not silently passed through", () => {
    code(() => interpolate("${steps.a.result}", ctx), "UNKNOWN_STEP_REF");
  });
});
