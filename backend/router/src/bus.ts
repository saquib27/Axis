/**
 * In-process event bus → SSE fan-out.
 *
 * The router emits RunEvents; the console subscribes per run. Deliberately
 * simple: a Map of runId → subscriber set, with a small ring buffer per run so
 * a console that connects slightly late still gets the events it missed.
 *
 * `emit` here takes the event WITHOUT seq/at/runId and stamps them, so call
 * sites stay clean and seq is guaranteed monotonic per run.
 */
import type { RunEvent } from "@axis/shared";

// A DISTRIBUTIVE omit. A plain Omit<RunEvent, ...> over a discriminated union
// collapses to only the keys common to every member (just `type`), silently
// dropping per-event fields like `step`. `T extends any ?` distributes the
// omit across each union member so each keeps its own shape.
type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;
type Raw = DistributiveOmit<RunEvent, "seq" | "at" | "runId">;
type Sub = (e: RunEvent) => void;

const subs = new Map<string, Set<Sub>>();
const seqs = new Map<string, number>();
const buffer = new Map<string, RunEvent[]>();
const BUFFER_MAX = 200;

// The most recently STARTED run, so a monitor (the Chrome extension) can
// auto-follow the live agent without being told a runId.
let latest: string | null = null;
export const latestRunId = (): string | null => latest;

// Runs that have reached a terminal event. A monitor opening mid-run should
// follow it; one opening after it ended should not replay it. Only the router
// knows which is which, so it says so.
const finished = new Set<string>();
export const isFinished = (runId: string): boolean => finished.has(runId);

export function emit(runId: string, raw: Raw): RunEvent {
  if (raw.type === "run.started") { latest = runId; finished.delete(runId); }
  if (raw.type === "run.completed" || raw.type === "run.error") finished.add(runId);
  const seq = (seqs.get(runId) ?? -1) + 1;
  seqs.set(runId, seq);
  const event = { ...raw, seq, at: new Date().toISOString(), runId } as RunEvent;

  const buf = buffer.get(runId) ?? [];
  buf.push(event);
  if (buf.length > BUFFER_MAX) buf.shift();
  buffer.set(runId, buf);

  for (const fn of subs.get(runId) ?? []) fn(event);
  return event;
}

export function subscribe(runId: string, fn: Sub): () => void {
  // Replay anything already emitted so a late subscriber is not out of sync.
  for (const e of buffer.get(runId) ?? []) fn(e);

  const set = subs.get(runId) ?? new Set();
  set.add(fn);
  subs.set(runId, set);
  return () => set.delete(fn);
}

/** Drop a run's buffers once it is terminal and nobody is listening. */
export function forget(runId: string): void {
  if ((subs.get(runId)?.size ?? 0) === 0) {
    subs.delete(runId);
    seqs.delete(runId);
    buffer.delete(runId);
  }
}
