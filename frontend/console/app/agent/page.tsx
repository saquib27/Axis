"use client";
import { useEffect, useState } from "react";
import { api, type ProjectSummary } from "../../lib/api.ts";
import { useRunStream } from "../../lib/useRunStream.ts";
import { ProtocolRail, WorkflowGraph, PolicyPanel, GroupPanel, ReceiptStrip, Outcome, EventLog } from "../../components/RunView.tsx";
import { isTerminal } from "../../lib/state-machine.ts";

export default function AgentPage() {
  const [goal, setGoal] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const view = useRunStream(runId);

  const streaming = !!runId && !isTerminal(view);

  useEffect(() => {
    api.projects().then((r) => {
      setProjects(r.projects);
      setProjectId((cur) => cur || r.projects[0]?.id || "");
    }).catch(() => {});
  }, []);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!goal.trim() || streaming) return;
    setErr(null);
    setRunId(null);
    try {
      // No budget field: spend is bounded by AXIS's own policy limits.
      const res = await api.runAgent(goal.trim(), projectId || undefined);
      setRunId(res.runId);
    } catch (x) {
      setErr((x as { error?: { message?: string } })?.error?.message ?? "could not start the agent");
    }
  }

  return (
    <main>
      <div className="dash-head">
        <h1>Autonomous agent</h1>
      </div>

      <form onSubmit={run} className="card stack">
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={3}
          placeholder="Describe a task in plain English — e.g. review this diff: bumped the request timeout from 10s to 60s"
          required
          style={{ width: "100%" }}
        />
        <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">— no project —</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button type="submit" disabled={streaming || !goal.trim()}>{streaming ? "working…" : "Run agent"}</button>
          {err ? <span className="pill pill-bad">{err}</span> : null}
        </div>
      </form>

      {runId ? (
        <>
          <Outcome view={view} />
          <ProtocolRail view={view} />
          <PolicyPanel view={view} />
          <WorkflowGraph view={view} />
          <GroupPanel view={view} />
          <ReceiptStrip view={view} />
          <EventLog view={view} />
          {isTerminal(view) && view.status === "FAILED" && view.error
            ? <p><b>Stopped — you paid nothing.</b> {view.error.message}</p>
            : null}
          {isTerminal(view) && view.receiptId && view.status !== "FAILED"
            ? <p><a href={`/receipts/${view.receiptId}`}>open the full unified receipt</a></p>
            : null}
        </>
      ) : null}
    </main>
  );
}
