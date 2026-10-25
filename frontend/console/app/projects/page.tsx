"use client";
import { useEffect, useState } from "react";
import { api, type ProjectSummary, type Usage } from "../../lib/api.ts";
import { ProjectDrawer } from "../../components/ProjectDrawer.tsx";

const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);

export default function Projects() {
  const [rows, setRows] = useState<ProjectSummary[] | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = () => {
    api.projects().then((r) => setRows(r.projects)).catch(() => setErr("could not load projects"));
    api.usage().then(setUsage).catch(() => {});
  };

  // Poll, so a project or run created from anywhere else — the autonomous
  // agent, or Claude over MCP — appears here without a manual refresh.
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || creating) return;
    setErr(null);
    setCreating(true);
    try {
      const p = await api.createProject(name.trim());
      setName("");
      setRows((cur) => [p, ...(cur ?? []).filter((r) => r.id !== p.id)]);
    } catch (x) {
      setErr((x as { error?: { message?: string } })?.error?.message ?? "could not create");
    } finally {
      setCreating(false);
    }
  }

  return (
    <main>
      <div className="dash-head">
        <h1>Projects</h1>
        <form className="dash-create" onSubmit={create}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="new project" disabled={creating} />
          <button type="submit" disabled={creating || !name.trim()}>{creating ? "creating…" : "create"}</button>
        </form>
      </div>

      <div className="stat-row">
        <div className="stat"><div className="k">projects</div><div className="v">{rows?.length ?? "—"}</div></div>
        <div className="stat"><div className="k">tasks</div><div className="v">{usage?.runs ?? "—"}</div></div>
        <div className="stat"><div className="k">settled</div><div className="v ok">{usage?.settled ?? "—"}</div></div>
        <div className="stat"><div className="k">net spent</div><div className="v">{usage ? `$${usage.netUSDC}` : "—"}</div></div>
        <div className="stat"><div className="k">refunded</div><div className="v warn">{usage ? `$${usage.refundedUSDC}` : "—"}</div></div>
      </div>

      {err ? <p className="dim">{err}</p> : null}

      {!rows ? <p className="dim">loading…</p>
        : rows.length === 0 ? <div className="empty-state">No projects yet — create one above.</div>
          : (
            <div className="proj-grid">
              {rows.map((p) => (
                <button key={p.id} className="proj-card" onClick={() => setOpenId(p.id)}>
                  <div className="nm">{p.name}</div>
                  <div className="figs">
                    <span><b>{p.runs}</b> tasks</span>
                    <span><b>${p.netUSDC}</b> net</span>
                    {Number(p.refundedUSDC) > 0 ? <span><b>${p.refundedUSDC}</b> back</span> : null}
                  </div>
                  <div className="when">{day(p.createdAt)}</div>
                </button>
              ))}
            </div>
          )}

      {openId ? <ProjectDrawer projectId={openId} onClose={() => { setOpenId(null); load(); }} /> : null}
    </main>
  );
}
