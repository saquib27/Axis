/**
 * The DAG resolver.
 *
 * A workflow is a set of steps where some steps consume another step's output.
 * This turns that into an execution plan: which steps can run AT THE SAME TIME,
 * and which must wait.
 *
 * For the pr-review demo:
 *   diff, guardrail, roast   ← no dependencies, all run in parallel
 *   bugsum                   ← consumes diff's output, runs after
 *
 * Emitting parallel BATCHES rather than a flat order is what keeps the demo
 * under 20 seconds: three LLM calls overlap instead of queueing.
 *
 * Pure functions, zero I/O. This and the policy guard are the two places a
 * silently wrong answer is possible, so both are properly tested.
 */
import { AxisError } from "../errors.ts";
import { MAX_PROVIDER_LEGS } from "../constants.ts";

export interface WorkflowStep {
  id: string;
  provider: string;
  input: Record<string, unknown>;
}

export interface ResolvedDag {
  /** batches[0] runs first, all in parallel; then batches[1]; and so on. */
  batches: string[][];
  edges: { from: string; to: string }[];
  order: string[];
}

/** Matches ${steps.<id>.output.<path>} — a reference to another step's result. */
const STEP_REF = /\$\{\s*steps\.([A-Za-z0-9_-]+)\.output(?:\.([A-Za-z0-9_.[\]-]+))?\s*\}/g;
/** Matches ${inputs.<path>} — a reference to the caller's own inputs. */
const INPUT_REF = /\$\{\s*inputs\.([A-Za-z0-9_.[\]-]+)\s*\}/g;

/** Walk every string in a nested value and collect regex matches. */
function scan(value: unknown, re: RegExp, out: Set<string>): void {
  if (typeof value === "string") {
    for (const m of value.matchAll(re)) if (m[1]) out.add(m[1]);
  } else if (Array.isArray(value)) {
    for (const v of value) scan(v, re, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) scan(v, re, out);
  }
}

export function stepDependencies(step: WorkflowStep): Set<string> {
  const deps = new Set<string>();
  scan(step.input, STEP_REF, deps);
  // A self-reference is deliberately KEPT. Stripping it here would make
  // `${steps.a.output.x}` inside step "a" silently resolve to nothing at
  // execute time — a step paid for and then handed undefined input. Leaving it
  // lets detectCycle report it as the cycle it is.
  return deps;
}

export function requiredInputs(steps: readonly WorkflowStep[]): Set<string> {
  const keys = new Set<string>();
  for (const s of steps) scan(s.input, INPUT_REF, keys);
  return keys;
}

/**
 * Resolve a workflow into parallel batches.
 *
 * Throws AxisError with a precise code — never a bare Error — because these
 * surface directly to the caller as typed HTTP responses.
 */
export function resolveDag(steps: readonly WorkflowStep[]): ResolvedDag {
  if (steps.length === 0) {
    throw new AxisError("INVALID_WORKFLOW", "workflow has no steps");
  }

  const ids = new Set<string>();
  for (const s of steps) {
    if (ids.has(s.id)) {
      throw new AxisError("INVALID_WORKFLOW", `duplicate step id: ${s.id}`, {
        stepId: s.id,
      });
    }
    ids.add(s.id);
  }

  // Every leg becomes one transaction in the atomic group, and one slot is
  // reserved for the fee payer — so the ceiling is 15, not 16.
  if (steps.length > MAX_PROVIDER_LEGS) {
    throw new AxisError(
      "GROUP_TOO_LARGE",
      `${steps.length} steps exceeds the ${MAX_PROVIDER_LEGS}-leg limit ` +
        `(atomic groups hold 16 transactions; one slot is the fee payer)`,
      { steps: steps.length, max: MAX_PROVIDER_LEGS },
    );
  }

  // Build the dependency graph, rejecting references to steps that don't exist.
  const deps = new Map<string, Set<string>>();
  const edges: { from: string; to: string }[] = [];
  for (const s of steps) {
    const d = stepDependencies(s);
    for (const dep of d) {
      if (!ids.has(dep)) {
        throw new AxisError(
          "UNKNOWN_STEP_REF",
          `step "${s.id}" references unknown step "${dep}"`,
          { stepId: s.id, missing: dep },
        );
      }
      edges.push({ from: dep, to: s.id });
    }
    deps.set(s.id, d);
  }

  detectCycle(steps, deps);

  // Kahn's algorithm, but emitting LEVELS instead of a flat order: every step
  // whose dependencies are already satisfied goes into the same batch and runs
  // concurrently.
  const remaining = new Map([...deps].map(([id, d]) => [id, new Set(d)]));
  const batches: string[][] = [];
  const done = new Set<string>();

  while (remaining.size > 0) {
    const ready = [...remaining.entries()]
      .filter(([, d]) => [...d].every((x) => done.has(x)))
      .map(([id]) => id);

    // Unreachable: detectCycle already threw. Kept as a guard against a future
    // edit silently producing an infinite loop.
    if (ready.length === 0) {
      throw new AxisError("DAG_CYCLE", "unresolvable dependency graph", {
        remaining: [...remaining.keys()],
      });
    }

    // Stable ordering so batches are deterministic across runs — the console
    // animation and the tests both depend on this.
    const order = new Map(steps.map((s, i) => [s.id, i]));
    ready.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));

    batches.push(ready);
    for (const id of ready) {
      remaining.delete(id);
      done.add(id);
    }
  }

  return { batches, edges, order: batches.flat() };
}

/** Depth-first search with a colour marker, reporting the actual cycle path. */
function detectCycle(
  steps: readonly WorkflowStep[],
  deps: Map<string, Set<string>>,
): void {
  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map<string, number>(steps.map((s) => [s.id, WHITE]));
  const stack: string[] = [];

  const visit = (id: string): void => {
    colour.set(id, GREY);
    stack.push(id);
    for (const dep of deps.get(id) ?? []) {
      const c = colour.get(dep);
      if (c === GREY) {
        const cycle = [...stack.slice(stack.indexOf(dep)), dep];
        throw new AxisError(
          "DAG_CYCLE",
          `circular dependency: ${cycle.join(" → ")}`,
          { cycle },
        );
      }
      if (c === WHITE) visit(dep);
    }
    stack.pop();
    colour.set(id, BLACK);
  };

  for (const s of steps) if (colour.get(s.id) === WHITE) visit(s.id);
}
