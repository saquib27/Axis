"use client";
/**
 * Run visualization. Every value comes from the state machine; these
 * components compute nothing — they only pick a class from the state so the
 * design system in globals.css can render it.
 */
import type { RunView } from "../lib/state-machine.ts";
import { outcomeHeadline, settledTxids, refundedNodes } from "../lib/state-machine.ts";

export function ProtocolRail({ view }: { view: RunView }) {
  if (view.status === "idle") return null;
  return (
    <div className="rail">
      {view.protocol.map((p, i) => (
        <div className="rail-step" key={p.step} data-status={p.status}>
          <div className="n">STEP {i + 1}</div>
          <div className="name">{p.step}</div>
          {p.detail ? <div className="detail" title={p.detail}>{p.detail}</div> : null}
        </div>
      ))}
    </div>
  );
}

export function WorkflowGraph({ view }: { view: RunView }) {
  if (view.batches.length === 0) return null;
  return (
    <div className="panel">
      <h3>Providers</h3>
      <div className="graph">
        {view.batches.map((batch, i) => (
          <div className="row" key={i} style={{ alignItems: "stretch" }}>
            {i > 0 ? <div className="arrow">→</div> : null}
            <div className="batch">
              <div className="batch-label">
                batch {i}{batch.length > 1 ? " · parallel" : ""}
              </div>
              {batch.map((id) => {
                const n = view.nodes[id];
                if (!n) return null;
                return (
                  <div className="node" key={id} data-state={n.state}>
                    <div className="provider">{n.provider}</div>
                    <div className="meta">
                      {n.state}{n.priceUSDC ? ` · $${n.priceUSDC}` : ""}
                      {n.latencyMs != null ? ` · ${n.latencyMs}ms` : ""}
                    </div>
                    {n.preview ? <div className="preview">{n.preview}</div> : null}
                    <div className="node-links">
                      {n.explorerUrl ? <a href={n.explorerUrl} target="_blank" rel="noreferrer">payment ↗</a> : null}
                      {n.compensationExplorerUrl ? <a href={n.compensationExplorerUrl} target="_blank" rel="noreferrer" style={{ color: "var(--warn)" }}>refund ↗</a> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PolicyPanel({ view }: { view: RunView }) {
  if (view.policy.checks.length === 0) return null;
  const pass = view.policy.verdict === "PASS";
  return (
    <div className="panel">
      <h3>
        Spend policy{" "}
        <span className={`pill ${pass ? "pill-ok" : "pill-bad"}`}>
          {view.policy.verdict ?? "evaluating"}
        </span>
      </h3>
      <div className="checks">
        {view.policy.checks.map((c) => (
          <div className="check" key={c.rule} data-pass={c.passed}>
            <span className="mark">{c.passed ? "✓" : "✕"}</span>
            <span className="rule">{c.rule}</span>
            <span className="vals">
              {c.headroomUSDC != null ? `${c.actualUSDC} / ${c.limitUSDC} · ${c.headroomUSDC} left` : ""}
            </span>
          </div>
        ))}
      </div>
      {view.policy.violations.length > 0 ? (
        <p style={{ color: "var(--bad)", marginBottom: 0 }}>blocked: {view.policy.violations[0]}</p>
      ) : null}
    </div>
  );
}

export function GroupPanel({ view }: { view: RunView }) {
  const g = view.group;
  if (!g.groupId && g.slots.length === 0) return null;
  return (
    <div className="panel">
      <h3>Atomic transaction group</h3>
      {g.signatureCount != null ? (
        <p style={{ marginBottom: 6 }}>
          <span className="pill pill-info">{g.signatureCount} signature</span>{" "}
          <span className="pill">{settledTxids(view).length || g.slots.length} payments</span>{" "}
          <span className="pill pill-ok">all-or-nothing</span>
        </p>
      ) : null}
      {g.slots.length > 0 ? (
        <div className="slots">
          {g.slots.map((s) => (
            <div className="slot" key={s.index}>
              <span className="idx">#{s.index}</span>
              <span>{s.kind}{s.stepId ? ` · ${s.stepId}` : ""}</span>
              {s.amountUSDC ? <span className="amt">${s.amountUSDC}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      {g.groupId ? (
        <p className="mono dim" style={{ marginBottom: 0, wordBreak: "break-all" }}>
          group {g.groupId} · round {g.confirmedRound}
        </p>
      ) : null}
      {g.simulated === false ? (
        <p style={{ color: "var(--bad)", marginBottom: 0 }}>
          simulation rejected — nothing submitted{g.simulationFailure ? `: ${g.simulationFailure}` : ""}
        </p>
      ) : null}
    </div>
  );
}

export function ReceiptStrip({ view }: { view: RunView }) {
  const tx = settledTxids(view);
  if (tx.length === 0) return null;
  return (
    <div className="panel">
      <h3>Settlement — {tx.length} txids to {new Set(tx.map((n) => n.payTo)).size} payees</h3>
      <table>
        <thead>
          <tr><th>provider</th><th>price</th><th>status</th><th>tx</th></tr>
        </thead>
        <tbody>
          {tx.map((n) => (
            <tr key={n.txid}>
              <td>{n.provider}</td>
              <td>${n.priceUSDC}</td>
              <td>
                <span className={`pill ${n.state === "delivered" ? "pill-ok" : n.state === "refunded" ? "pill-warn" : ""}`}>
                  {n.state}
                </span>
              </td>
              <td><a href={n.explorerUrl} target="_blank" rel="noreferrer">explorer ↗</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Outcome({ view }: { view: RunView }) {
  if (view.status === "idle") return null;
  const refunds = refundedNodes(view);
  const tone =
    view.status === "SETTLED" ? "ok"
    : view.status === "PARTIAL" || view.status === "REVERSED" ? "warn"
    : view.status === "FAILED" ? "bad"
    : "run";
  return (
    <div className={`outcome ${tone}`}>
      <h3>{outcomeHeadline(view)}</h3>
      {view.error?.costedNothing ? <p style={{ marginBottom: 0 }}>You were charged nothing.</p> : null}
      {refunds.length > 0 ? (
        <p style={{ marginBottom: 0 }}>
          {refunds.length} provider took payment and failed to deliver — reversed on chain.
        </p>
      ) : null}
      {view.hasGap ? <p style={{ marginBottom: 0, color: "var(--warn)" }}>connection gap — some events may be missing</p> : null}
    </div>
  );
}

export function EventLog({ view }: { view: RunView }) {
  if (view.log.length === 0) return null;
  return (
    <details>
      <summary>raw event stream ({view.log.length})</summary>
      <pre>{view.log.map((e) => `${String(e.seq).padStart(3, "0")}  ${e.type}`).join("\n")}</pre>
    </details>
  );
}
