/**
 * Execute-time substitution: turn ${inputs.x} and ${steps.a.output.b} into real
 * values once the referenced steps have actually returned.
 *
 * The hard rule here: a missing value is a THROWN ERROR, never `undefined`.
 * A provider that has already been paid must never be handed garbage input —
 * that is money spent for a guaranteed-useless result.
 */
import { AxisError } from "../errors.ts";

export interface InterpolationContext {
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
}

const REF = /\$\{\s*(inputs|steps)\.([A-Za-z0-9_.[\]-]+?)\s*\}/g;

/** Read "a.b.c" out of a nested object. Returns undefined if any hop is absent. */
function dig(source: unknown, path: string): unknown {
  return path
    .split(".")
    .filter(Boolean)
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      source,
    );
}

function resolveRef(kind: string, path: string, ctx: InterpolationContext): unknown {
  if (kind === "inputs") {
    const v = dig(ctx.inputs, path);
    if (v === undefined) {
      throw new AxisError("MISSING_INPUT", `missing workflow input: inputs.${path}`, {
        reference: `inputs.${path}`,
      });
    }
    return v;
  }

  // steps.<id>.output(.<rest>)
  const [stepId, marker, ...rest] = path.split(".");
  if (!stepId || marker !== "output") {
    throw new AxisError(
      "UNKNOWN_STEP_REF",
      `malformed step reference: steps.${path} (expected steps.<id>.output...)`,
      { reference: `steps.${path}` },
    );
  }
  if (!(stepId in ctx.outputs)) {
    throw new AxisError(
      "UNKNOWN_STEP_REF",
      `step "${stepId}" has produced no output yet`,
      { reference: `steps.${path}`, stepId },
    );
  }
  const out = ctx.outputs[stepId];
  const value = rest.length === 0 ? out : dig(out, rest.join("."));
  if (value === undefined) {
    throw new AxisError(
      "MISSING_INPUT",
      `steps.${path} resolved to undefined — refusing to call a paid provider ` +
        `with missing input`,
      { reference: `steps.${path}`, stepId },
    );
  }
  return value;
}

/**
 * Substitute references throughout a nested value.
 *
 * A string that is EXACTLY one reference keeps the referenced value's type —
 * so `"${steps.a.output.score}"` yields the number 0.4, not the string "0.4".
 * Mixed strings interpolate as text.
 */
export function interpolate<T>(template: T, ctx: InterpolationContext): T {
  if (typeof template === "string") {
    const whole = template.match(new RegExp(`^${REF.source}$`));
    if (whole?.[1] && whole[2]) {
      return resolveRef(whole[1], whole[2], ctx) as T;
    }
    return template.replace(REF, (_m, kind: string, path: string) => {
      const v = resolveRef(kind, path, ctx);
      return typeof v === "string" ? v : JSON.stringify(v);
    }) as T;
  }
  if (Array.isArray(template)) {
    return template.map((v) => interpolate(v, ctx)) as T;
  }
  if (template && typeof template === "object") {
    return Object.fromEntries(
      Object.entries(template).map(([k, v]) => [k, interpolate(v, ctx)]),
    ) as T;
  }
  return template;
}
