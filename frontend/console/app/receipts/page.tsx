"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, type ReceiptSummary } from "../../lib/api";

const stamp = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace("T", " ");

const statusPill = (s: string) =>
  s === "SETTLED" ? "pill pill-ok"
    : s === "PARTIAL" || s === "REVERSED" ? "pill pill-warn"
      : s === "FAILED" ? "pill pill-bad"
        : "pill";

export default function Receipts() {
  const [id, setId] = useState("");
  const [rows, setRows] = useState<ReceiptSummary[] | null>(null);
  const [projMap, setProjMap] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    api.receipts().then((r) => setRows(r.receipts)).catch(() => setErr("could not load receipts"));
    api.projects().then((r) => setProjMap(Object.fromEntries(r.projects.map((p) => [p.id, p.name])))).catch(() => {});
  }, []);

  const settled = rows?.filter((r) => r.status === "SETTLED").length ?? 0;
  const partial = rows?.filter((r) => r.status === "PARTIAL").length ?? 0;
  const gross = rows?.reduce((a, r) => a + Number(r.totalUSDC), 0) ?? 0;

  return (
    <main>
      <div className="dash-head">
        <h1>Receipts</h1>
        <form
          className="dash-create"
          onSubmit={(e) => { e.preventDefault(); if (id.trim()) router.push(`/receipts/${id.trim()}`); }}
        >
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="run_… / receipt id" />
          <button type="submit" disabled={!id.trim()}>open</button>
        </form>
      </div>

      <div className="stat-row">
        <div className="stat"><div className="k">receipts</div><div className="v">{rows?.length ?? "—"}</div></div>
        <div className="stat"><div className="k">settled</div><div className="v ok">{rows ? settled : "—"}</div></div>
        <div className="stat"><div className="k">partial</div><div className="v warn">{rows ? partial : "—"}</div></div>
        <div className="stat"><div className="k">gross</div><div className="v">{rows ? `$${gross.toFixed(2)}` : "—"}</div></div>
      </div>

      {err ? <p className="dim">{err}</p> : null}
      {!rows && !err ? <p className="dim">loading…</p> : null}
      {rows && rows.length === 0 ? <div className="empty-state">No runs yet. Run a workflow and it will appear here.</div> : null}

      {rows && rows.length > 0 ? (
        <table>
          <thead>
            <tr><th>receipt</th><th>project</th><th>workflow</th><th>status</th><th>total</th><th>refunded</th><th>when</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.receiptId}>
                <td><Link href={`/receipts/${r.receiptId}`}>{r.receiptId}</Link></td>
                <td>{r.projectId ? <Link href={`/workflow?project=${r.projectId}`}>{projMap[r.projectId] ?? r.projectId}</Link> : <span className="dim">—</span>}</td>
                <td>{r.workflow}</td>
                <td><span className={statusPill(r.status)}>{r.status}</span></td>
                <td>${r.totalUSDC}</td>
                <td>{Number(r.refundedUSDC) > 0 ? `$${r.refundedUSDC}` : <span className="dim">—</span>}</td>
                <td className="dim">{stamp(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </main>
  );
}
