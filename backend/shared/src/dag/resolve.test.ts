import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveDag, stepDependencies, requiredInputs } from "./resolve.ts";
import type { WorkflowStep } from "./resolve.ts";
import { AxisError } from "../errors.ts";

const step = (id: string, input: Record<string, unknown> = {}): WorkflowStep => ({
  id,
  provider: `${id}-provider`,
  input,
});

const ref = (id: string, path = "summary") => `\${steps.${id}.output.${path}}`;

/** Assert a thrown AxisError carries the expected code. */
function throwsCode(fn: () => unknown, code: string) {
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof AxisError, `expected AxisError, got ${e}`);
    assert.equal(e.code, code);
    return true;
  });
}

describe("resolveDag — batching", () => {
  test("independent steps all land in ONE parallel batch", () => {
    const dag = resolveDag([step("a"), step("b"), step("c")]);
    assert.deepEqual(dag.batches, [["a", "b", "c"]]);
    assert.equal(dag.edges.length, 0);
  });

  test("the pr-review demo shape: 3 parallel, then 1 dependent", () => {
    const dag = resolveDag([
      step("diff", { diff: "${inputs.diff}" }),
      step("guardrail", { text: "${inputs.diff}" }),
      step("roast", { message: "${inputs.commitMessage}" }),
      step("bugsum", { report: ref("diff") }),
    ]);
    assert.deepEqual(dag.batches, [["diff", "guardrail", "roast"], ["bugsum"]]);
    assert.deepEqual(dag.edges, [{ from: "diff", to: "bugsum" }]);
  });

  test("a linear chain produces one step per batch", () => {
    const dag = resolveDag([
      step("a"),
      step("b", { x: ref("a") }),
      step("c", { x: ref("b") }),
    ]);
    assert.deepEqual(dag.batches, [["a"], ["b"], ["c"]]);
  });

  test("a diamond converges into three batches", () => {
    const dag = resolveDag([
      step("a"),
      step("b", { x: ref("a") }),
      step("c", { x: ref("a") }),
      step("d", { x: ref("b"), y: ref("c") }),
    ]);
    assert.deepEqual(dag.batches, [["a"], ["b", "c"], ["d"]]);
  });

  test("declaration order does not change the plan", () => {
    const dag = resolveDag([
      step("last", { x: ref("first") }),
      step("first"),
    ]);
    assert.deepEqual(dag.batches, [["first"], ["last"]]);
  });

  test("finds references nested in arrays and objects", () => {
    const dag = resolveDag([
      step("a"),
      step("b", { deep: { list: [{ v: ref("a") }] } }),
    ]);
    assert.deepEqual(dag.batches, [["a"], ["b"]]);
  });
});

describe("resolveDag — rejections", () => {
  test("empty workflow", () => {
    throwsCode(() => resolveDag([]), "INVALID_WORKFLOW");
  });

  test("duplicate step ids", () => {
    throwsCode(() => resolveDag([step("a"), step("a")]), "INVALID_WORKFLOW");
  });

  test("reference to a step that does not exist", () => {
    throwsCode(() => resolveDag([step("a", { x: ref("ghost") })]), "UNKNOWN_STEP_REF");
  });

  test("two-step cycle", () => {
    throwsCode(
      () => resolveDag([step("a", { x: ref("b") }), step("b", { x: ref("a") })]),
      "DAG_CYCLE",
    );
  });

  test("three-step cycle reports the path", () => {
    assert.throws(
      () =>
        resolveDag([
          step("a", { x: ref("c") }),
          step("b", { x: ref("a") }),
          step("c", { x: ref("b") }),
        ]),
      (e: unknown) => {
        assert.ok(e instanceof AxisError);
        assert.equal(e.code, "DAG_CYCLE");
        assert.match(e.message, /→/); // the actual cycle path, not just "a cycle exists"
        return true;
      },
    );
  });

  test("self-reference is a cycle, not a silent no-op", () => {
    throwsCode(() => resolveDag([step("a", { x: ref("a") })]), "DAG_CYCLE");
  });

  test("16 steps exceeds the 15-leg limit (one slot is the fee payer)", () => {
    const many = Array.from({ length: 16 }, (_, i) => step(`s${i}`));
    throwsCode(() => resolveDag(many), "GROUP_TOO_LARGE");
  });

  test("15 steps is exactly at the limit and is allowed", () => {
    const many = Array.from({ length: 15 }, (_, i) => step(`s${i}`));
    assert.equal(resolveDag(many).order.length, 15);
  });
});

describe("reference extraction", () => {
  test("stepDependencies ignores input refs", () => {
    const d = stepDependencies(step("x", { a: ref("dep"), b: "${inputs.foo}" }));
    assert.deepEqual([...d], ["dep"]);
  });

  test("tolerates whitespace inside the braces", () => {
    const d = stepDependencies(step("x", { a: "${ steps.dep.output.v }" }));
    assert.deepEqual([...d], ["dep"]);
  });

  test("a bare output reference with no path still counts", () => {
    const d = stepDependencies(step("x", { a: "${steps.dep.output}" }));
    assert.deepEqual([...d], ["dep"]);
  });

  test("requiredInputs collects every caller input referenced", () => {
    const got = requiredInputs([
      step("a", { x: "${inputs.diff}" }),
      step("b", { y: "${inputs.commitMessage}", z: ref("a") }),
    ]);
    assert.deepEqual([...got].sort(), ["commitMessage", "diff"]);
  });
});
