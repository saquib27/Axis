/**
 * LLM client — NVIDIA NIM, which speaks the OpenAI chat-completions wire format.
 *
 * Deliberately raw `fetch` rather than the openai SDK: it is ~40 lines, it keeps
 * the Worker bundle small, and it means no SDK surprises on `workerd`.
 *
 * The important behaviour here is `jsonComplete`. Two of our four endpoints must
 * return parseable JSON, and NIM's structured-output support varies by model. So
 * instead of trusting it, we ask for JSON, validate against a Zod schema, and
 * retry ONCE with the parse error fed back. A paid endpoint must never return
 * malformed output to a caller who has already been charged.
 */
import { z } from "zod";

export interface LlmEnv {
  NVIDIA_API_KEY: string;
  NVIDIA_BASE_URL?: string;
  NVIDIA_MODEL?: string;
}

const DEFAULT_BASE = "https://integrate.api.nvidia.com/v1";
const DEFAULT_MODEL = "meta/llama-3.1-8b-instruct";

export class LlmError extends Error {
  // Declared and assigned explicitly rather than as a constructor parameter
  // property: those require code GENERATION, and Node's type stripping only
  // erases types. A parameter property here fails at runtime under `node x.ts`.
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "LlmError";
    this.status = status;
  }
}

async function chat(
  env: LlmEnv,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  opts: { maxTokens?: number; jsonMode?: boolean } = {},
): Promise<string> {
  const res = await fetch(`${env.NVIDIA_BASE_URL ?? DEFAULT_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.NVIDIA_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.NVIDIA_MODEL ?? DEFAULT_MODEL,
      messages,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: 0.2,
      ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!res.ok) {
    throw new LlmError(`NIM ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status);
  }
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = body.choices?.[0]?.message?.content;
  if (!text) throw new LlmError("NIM returned no content");
  return text;
}

/** Free-text completion. */
export const complete = (
  env: LlmEnv,
  system: string,
  user: string,
  maxTokens?: number,
): Promise<string> =>
  chat(env, [{ role: "system", content: system }, { role: "user", content: user }], { maxTokens });

/** Strip ```json fences some models add even in JSON mode. */
function unfence(s: string): string {
  const t = s.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return (m?.[1] ?? t).trim();
}

/**
 * JSON completion validated against a schema, with one corrective retry.
 * Throws only if the model fails twice — at which point the caller returns 502
 * and the router compensates that leg rather than paying for garbage.
 */
export async function jsonComplete<T>(
  env: LlmEnv,
  schema: z.ZodType<T>,
  system: string,
  user: string,
  maxTokens = 1024,
): Promise<T> {
  const msgs: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: `${system}\n\nRespond with a single JSON object and nothing else.` },
    { role: "user", content: user },
  ];

  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await chat(env, msgs, { maxTokens, jsonMode: true });
    try {
      return schema.parse(JSON.parse(unfence(raw)));
    } catch (err) {
      if (attempt === 1) {
        throw new LlmError(`model returned invalid JSON twice: ${(err as Error).message}`);
      }
      // Feed the failure back so the retry is corrective, not just a re-roll.
      msgs.push(
        { role: "assistant", content: raw },
        {
          role: "user",
          content:
            `That was not valid against the required schema: ${(err as Error).message}\n` +
            `Return ONLY a corrected JSON object.`,
        },
      );
    }
  }
  throw new LlmError("unreachable");
}
