"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type RefundSummary } from "../../lib/api.ts";

const stamp = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace("T", " ");

export default function Refunds() {
  const [rows, setRows] = useState<RefundSummary[] | null>(null);
  const [projMap, setProjMap] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.refunds().then((r) => setRows(r.refunds)).catch(() => setErr("could not load refunds"));
    api.projects().then((r) => setProjMap(Object.fromEntries(r.projects.map((p) => [p.id, p.name])))).catch(() => {});
  }, []);

  const total = rows?.reduce((a, r) => a + Number(r.refundedUSDC), 0) ?? 0;
  const ofTotal = rows?.reduce((a, r) => a + Number(r.totalUSDC), 0) ?? 0;

  return (
    <main>
      <div className="dash-head">
        <h1>Refunds</h1>
        <span className="dim">a provider took payment and failed — the leg was reversed on chain</span>
      </div>

      <div className="stat-row">
        <div className="stat"><div className="k">refunded runs</div><div className="v">{rows?.length ?? "—"}</div></div>
        <div className="stat"><div className="k">returned on chain</div><div className="v warn">{rows ? `$${total.toFixed(2)}` : "—"}</div></div>
        <div className="stat"><div className="k">of gross</div><div className="v">{rows ? `$${ofTotal.toFixed(2)}` : "—"}</div></div>
      </div>

      {err ? <p className="dim">{err}</p> : null}
      {!rows && !err ? <p className="dim">loading…</p> : null}
      {rows && rows.length === 0 ? <div className="empty-state">No refunds yet.</div> : null}

      {rows && rows.length > 0 ? (
        <table>
          <thead><tr><th>receipt</th><th>project</th><th>workflow</th><th>status</th><th>refunded</th><th>of total</th><th>when</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.receiptId}>
                <td><Link href={`/receipts/${r.receiptId}`}>{r.receiptId}</Link></td>
                <td>{r.projectId ? <Link href={`/workflow?project=${r.projectId}`}>{projMap[r.projectId] ?? r.projectId}</Link> : <span className="dim">—</span>}</td>
                <td>{r.workflow}</td>
                <td><span className="pill pill-warn">{r.status}</span></td>
                <td>${r.refundedUSDC}</td>
                <td className="dim">${r.totalUSDC}</td>
                <td className="dim">{stamp(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </main>
  );
}
