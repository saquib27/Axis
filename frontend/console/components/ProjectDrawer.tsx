"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, type ProjectDetail } from "../lib/api.ts";
import { useRunStream } from "../lib/useRunStream.ts";
import { ProtocolRail, WorkflowGraph, PolicyPanel, GroupPanel, ReceiptStrip, Outcome, EventLog } from "./RunView.tsx";
import { isTerminal } from "../lib/state-machine.ts";

const stamp = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace("T", " ");

const statusPill = (s: string) =>
  s === "SETTLED" ? "pill pill-ok"
    : s === "PARTIAL" || s === "REVERSED" ? "pill pill-warn"
      : s === "FAILED" ? "pill pill-bad"
        : "pill";

/**
 * One project's whole recording, in a slide-over drawer: totals, the run that
 * is happening right now (streamed live off the router's SSE), and every task
 * ever run under it with its prompt, cost and receipt.
 *
 * It polls while open, so a task fired from anywhere else — the autonomous
 * agent, an MCP client like Claude — appears here as it happens, with no
 * reload and nothing scripted.
 */
export function ProjectDrawer({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [liveRunId, setLiveRunId] = useState<string | null>(null);
  const seen = useRef(new Set<string>());
  const view = useRunStream(liveRunId);
  const liveActive = !!liveRunId && !isTerminal(view);

  useEffect(() => {
    let stopped = false;
    const poll = () => api.project(projectId).then((d) => {
      if (stopped || (d as unknown as { error?: unknown }).error) return;
      setDetail(d);
      // Only follow a run that is genuinely still in flight. Attaching to a
      // finished run would replay its buffered events and render a "running
      // now" panel for something that ended hours ago.
      const newest = d.runs[0];
      if (newest && newest.status === "PENDING" && !seen.current.has(newest.receiptId)) {
        seen.current.add(newest.receiptId);
        setLiveRunId(newest.receiptId);
      }
    }).catch(() => {});
    poll();
    const t = setInterval(poll, 2500);
    return () => { stopped = true; clearInterval(t); };
  }, [projectId]);

  // Escape closes, and the page behind must not scroll while the drawer is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <>
      <button className="drawer-scrim" onClick={onClose} aria-label="Close" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={detail ? `Project ${detail.name}` : "Project"}>
        <div className="drawer-head">
          <h2>{detail?.name ?? "…"}</h2>
          {liveActive ? <span className="pill pill-info">live</span> : null}
          <button className="x" onClick={onClose}>close</button>
        </div>

        <div className="drawer-body">
          {!detail ? <p className="dim">loading…</p> : (
            <>
              <div className="drawer-figs">
                <div><div className="k">tasks</div><div className="v">{detail.totals.runs}</div></div>
                <div><div className="k">net spent</div><div className="v">${detail.totals.netUSDC}</div></div>
                <div><div className="k">gross</div><div className="v">${detail.totals.grossUSDC}</div></div>
                <div><div className="k">refunded</div><div className="v">${detail.totals.refundedUSDC}</div></div>
              </div>

              {liveActive ? (
                <>
                  <h3>Running now</h3>
                  <Outcome view={view} />
                  <ProtocolRail view={view} />
                  <PolicyPanel view={view} />
                  <WorkflowGraph view={view} />
                  <GroupPanel view={view} />
                  <ReceiptStrip view={view} />
                  <EventLog view={view} />
                </>
              ) : null}

              <h3>Recording</h3>
              {detail.runs.length === 0 ? (
                <div className="empty-state">
                  No tasks yet. Run the <Link href="/agent">autonomous agent</Link> against this project — every task lands here live.
                </div>
              ) : detail.runs.map((r) => (
                <div key={r.receiptId} className={`task-row${r.receiptId === liveRunId && liveActive ? " is-live" : ""}`}>
                  <div className={`prompt${r.prompt ? "" : " none"}`}>{r.prompt || "no prompt recorded"}</div>
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
            </>
          )}
        </div>
      </aside>
    </>
  );
}
