"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type ProjectSummary, type ReceiptSummary } from "../../lib/api.ts";
import { ProjectDrawer } from "../../components/ProjectDrawer.tsx";

const stamp = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace("T", " ");

const statusPill = (s: string) =>
  s === "SETTLED" ? "pill pill-ok"
    : s === "PARTIAL" || s === "REVERSED" ? "pill pill-warn"
      : s === "FAILED" ? "pill pill-bad"
        : "pill";

/**
 * Workflow — the activity surface across every project. Recent tasks from
 * anywhere (this console, the autonomous agent, an MCP client like Claude)
 * land here as they happen; clicking a project opens its full recording in
 * the same drawer the Projects page uses.
 */
export default function WorkflowPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [receipts, setReceipts] = useState<ReceiptSummary[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    // Deep link from a project card: /workflow?project=proj_xyz
    const fromUrl = new URLSearchParams(window.location.search).get("project");
    if (fromUrl) setOpenId(fromUrl);
  }, []);

  useEffect(() => {
    let stopped = false;
    const poll = () => {
      api.projects().then((r) => { if (!stopped) setProjects(r.projects); }).catch(() => {});
      api.receipts().then((r) => { if (!stopped) setReceipts(r.receipts); }).catch(() => { if (!stopped) setReceipts([]); });
    };
    poll();
    const t = setInterval(poll, 4000);
    return () => { stopped = true; clearInterval(t); };
  }, []);

  const nameOf = (id: string | null) => projects.find((p) => p.id === id)?.name ?? null;
  const recent = (receipts ?? []).slice(0, 25);

  return (
    <main>
      <div className="dash-head">
        <h1>Workflow</h1>
      </div>

      <h3>Projects</h3>
      {projects.length === 0
        ? <div className="empty-state">No projects yet — <Link href="/projects">create one</Link>, then run the <Link href="/agent">autonomous agent</Link> against it.</div>
        : (
          <div className="proj-grid">
            {projects.map((p) => (
              <button key={p.id} className="proj-card" onClick={() => setOpenId(p.id)}>
                <div className="nm">{p.name}</div>
                <div className="figs">
                  <span><b>{p.runs}</b> tasks</span>
                  <span><b>${p.netUSDC}</b> net</span>
                </div>
                <div className="when">open recording →</div>
              </button>
            ))}
          </div>
        )}

      <h3>Recent activity</h3>
      {!receipts ? <p className="dim">loading…</p>
        : recent.length === 0 ? <div className="empty-state">No tasks yet.</div>
          : recent.map((r) => (
            <div key={r.receiptId} className="task-row">
              <div className="prompt">
                {r.projectId
                  ? <button className="linklike" onClick={() => setOpenId(r.projectId!)}>{nameOf(r.projectId) ?? r.projectId}</button>
                  : <span className="dim">no project</span>}
              </div>
              <div className="amt">
                ${r.totalUSDC}
                {Number(r.refundedUSDC) > 0 ? <><br /><span className="dim">−${r.refundedUSDC}</span></> : null}
              </div>
              <div className="meta">
                <span className={statusPill(r.status)}>{r.status}</span>
                <span>{r.workflow}</span>
                <span>{stamp(r.createdAt)}</span>
                <Link href={`/receipts/${r.receiptId}`}>receipt →</Link>
              </div>
            </div>
          ))}

      {openId ? <ProjectDrawer projectId={openId} onClose={() => setOpenId(null)} /> : null}
    </main>
  );
}
