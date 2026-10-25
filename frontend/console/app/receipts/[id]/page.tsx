"use client";
import { use, useEffect, useState } from "react";

const BASE = process.env.NEXT_PUBLIC_ROUTER_URL ?? "http://localhost:8080";

interface Leg {
  stepId: string;
  provider: string;
  priceUSDC: string;
  txid: string;
  explorerUrl: string;
  status: string;
  result?: unknown;
  latencyMs?: number;
  compensationExplorerUrl?: string;
}
interface Receipt {
  receiptId: string; workflow: string; status: string; groupId: string;
  confirmedRound?: number; totalUSDC: string; refundedUSDC: string; legs: Leg[];
}

/** Pull the human-readable text out of a provider result, whatever its shape. */
function resultText(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result;
  if (typeof result === "object") {
    const o = result as Record<string, unknown>;
    const inner = (o.result ?? o) as Record<string, unknown>;
    for (const k of ["summary", "explanation", "text", "roast", "verdict", "output"]) {
      if (typeof inner[k] === "string") return inner[k] as string;
    }
    return JSON.stringify(result, null, 2);
  }
  return String(result);
}

export default function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [r, setR] = useState<Receipt | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${BASE}/v1/receipt/${id}`, { headers: { "x-api-key": localStorage.getItem("axis_apikey") ?? "" } }).then(async (res) => {
      if (!res.ok) throw new Error(`${res.status}`);
      setR(await res.json());
    }).catch((e) => setErr(String(e)));
  }, [id]);

  if (err) return <main><p>receipt {id}: {err}</p></main>;
  if (!r) return <main><p>loading receipt {id}…</p></main>;

  const tone = r.status === "SETTLED" ? "pill-ok" : r.status === "PARTIAL" ? "pill-warn" : r.status === "FAILED" ? "pill-bad" : "";
  return (
    <main>
      <h1>Receipt <span className={`pill ${tone}`} style={{ verticalAlign: "middle", fontSize: 13 }}>{r.status}</span></h1>
      <div className="card row" style={{ gap: 28 }}>
        <div>
          <div className="dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>Total</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>${r.totalUSDC}</div>
        </div>
        {Number(r.refundedUSDC) > 0 ? (
          <div>
            <div className="dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>Refunded</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--warn)" }}>${r.refundedUSDC}</div>
          </div>
        ) : null}
        <div style={{ minWidth: 0 }}>
          <div className="dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>Group · round</div>
          <div className="mono" style={{ wordBreak: "break-all", fontSize: 12 }}>{r.groupId} · {r.confirmedRound ?? "—"}</div>
        </div>
      </div>

      {r.legs.map((l) => {
        const lt = l.status === "DELIVERED" ? "pill-ok" : l.status === "COMPENSATED" ? "pill-warn" : l.status === "FAILED" ? "pill-bad" : "";
        return (
          <div className="panel" key={l.txid || l.stepId}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>
                {l.provider} <span className={`pill ${lt}`}>{l.status}</span>
              </h3>
              <span className="mono dim" style={{ fontSize: 13 }}>
                ${l.priceUSDC}{l.latencyMs != null && ` · ${l.latencyMs}ms`}
              </span>
            </div>
            <p className="mono" style={{ marginTop: 8, marginBottom: 8, fontSize: 13 }}>
              {l.explorerUrl && <a href={l.explorerUrl} target="_blank" rel="noreferrer">payment ↗</a>}
              {l.compensationExplorerUrl && <> · <a href={l.compensationExplorerUrl} target="_blank" rel="noreferrer" style={{ color: "var(--warn)" }}>refund ↗</a></>}
            </p>
            {l.result != null
              ? <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, marginBottom: 0 }}>{resultText(l.result)}</pre>
              : <p style={{ marginBottom: 0 }}>(no result — {l.status.toLowerCase()})</p>}
          </div>
        );
      })}
    </main>
  );
}
