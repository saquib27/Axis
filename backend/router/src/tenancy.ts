/**
 * Per-account scoping. Each account has an API key; the router remembers that
 * account's most recent run so the extension (and dashboard) can follow only
 * THEIR activity — not everyone's.
 */
const ownerByRun = new Map<string, string>();
export const liveRunOwner = (runId: string) => ownerByRun.get(runId);

const latestByKey = new Map<string, string>();

export function setLatestRun(apiKey: string | undefined | null, runId: string): void {
  if (apiKey) { latestByKey.set(apiKey, runId); ownerByRun.set(runId, apiKey); }
}

export function getLatestRun(apiKey: string): string | null {
  return latestByKey.get(apiKey) ?? null;
}
