"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { useRunStream, useMockRun } from "../../lib/useRunStream.ts";
import { ProtocolRail, WorkflowGraph, GroupPanel, ReceiptStrip, Outcome, EventLog } from "../../components/RunView.tsx";
import { isTerminal, refundedNodes } from "../../lib/state-machine.ts";

/** The all-services workflow — every provider AXIS knows, in one atomic group. */
const WORKFLOW = "deep-review";

export default function Failure() {
  const [prompt, setPrompt] = useState(
    "Increase the request timeout from 10 seconds to 60 seconds so slow upstream calls don't fail spuriously.",
  );
  // The failure targets are the workflow's REAL steps, read from the router.
  // Nothing here is a hardcoded list of four.
  const [steps, setSteps] = useState<{ id: string; provider: string }[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [mockTick, setMockTick] = useState(0);
  const [useMock, setUseMock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chaos, setChaos] = useState("");
  const live = useRunStream(runId);
  const mock = useMockRun("partial", mockTick);
  const view = useMock ? mock : live;

  useEffect(() => {
    api.workflows().then(({ workflows }) => {
      const wf = workflows.find((w) => w.id === WORKFLOW);
      if (!wf) return;
      setSteps(wf.steps.map((s) => ({ id: s.id, provider: s.provider })));
      setChaos((cur) => cur || wf.steps[0]?.id || "");
    }).catch(() => {});
  }, []);

  const run = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const quote = await api.quote({ diff: prompt, commitMessage: prompt }, WORKFLOW);
      setUseMock(false); setRunId(quote.runId);
      await api.executeChaos(quote.quoteId, quote.runId, chaos);
    } catch { setUseMock(true); setMockTick((t) => t + 1); }
    finally { setBusy(false); }
  }, [chaos, prompt]);

  const refunds = refundedNodes(view);

  return (
    <main>
      <div className="dash-head">
        <h1>Test failure</h1>
        <span className="dim">payment atomicity is not delivery — force a paid provider to die</span>
      </div>

      <form onSubmit={run} className="card stack">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          placeholder="Describe the code change in plain English"
          required
          style={{ width: "100%" }}
        />
        <div>
          <div className="field-label">
            which of the {steps.length || "…"} services fails after being paid
          </div>
          <div className="chip-row">
            {steps.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`chip${chaos === s.id ? " on" : ""}`}
                onClick={() => setChaos(s.id)}
                aria-pressed={chaos === s.id}
              >
                {s.provider}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <button type="submit" disabled={busy || !chaos}>{busy ? "running…" : `Run with ${chaos || "…"} failing`}</button>
          {useMock ? <span className="pill pill-warn">demo mode · router offline</span> : null}
        </div>
      </form>

      <div className="step-row">
        {[
          `All ${steps.length || "N"} services are paid atomically in one group.`,
          "Every one delivers except the one you picked, which returns 502 after taking payment.",
          "AXIS reverses that leg on chain — a real refund transaction.",
          "The run is marked PARTIAL; the receipt records the refund txid.",
        ].map((s, i) => (
          <div key={s} className="step"><span className="n">{i + 1}</span>{s}</div>
        ))}
      </div>

      <Outcome view={view} />

      {refunds.length > 0 ? (
        <>
          <h3>Reversal on chain</h3>
          {refunds.map((n) => (
            <div key={n.stepId} className="task-row">
              <div className="prompt">{n.provider} took ${n.priceUSDC}, failed, and was refunded</div>
              <div className="amt">−${n.priceUSDC}</div>
              <div className="meta">
                <span className="pill pill-warn">reversed</span>
                <a href={n.compensationExplorerUrl} target="_blank" rel="noreferrer">refund txid →</a>
              </div>
            </div>
          ))}
        </>
      ) : null}

      <ProtocolRail view={view} />
      <WorkflowGraph view={view} />
      <GroupPanel view={view} />
      <ReceiptStrip view={view} />
      <EventLog view={view} />
      {isTerminal(view) && view.receiptId ? <p><a href={`/receipts/${view.receiptId}`}>open the receipt</a></p> : null}
    </main>
  );
}
