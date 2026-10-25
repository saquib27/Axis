"use client";
import { useState } from "react";
import { api } from "../../lib/api.ts";

interface AttackResult { fired: number; blocked: number; granted: number; mitigation: string; detail: string }

const LIVE = [
  {
    id: "replay", n: "Replay",
    tag: "one payment, used many times",
    what: "Copy ONE real payment and slam the server with 12 identical copies at the same instant.",
    how: "The server remembers every payment. The first copy spends it and is served; the other 11 find it already spent.",
    diagram: true,
  },
  {
    id: "cross-resource", n: "Cross-resource",
    tag: "a payment used on the wrong service",
    what: "Take a payment made for the cheap /diff service and try to use it on the pricier /bug service.",
    how: "Every payment is stamped with which service it was for. Used anywhere else, it is rejected on sight.",
    diagram: false,
  },
  {
    id: "cache", n: "Cache leak",
    tag: "a paid answer served to someone who didn't pay",
    what: "Ask for a paid answer without paying, hoping a cache in front of the server still holds someone else's copy.",
    how: "Every paid answer is marked “do not store”, so no cache can hand it to a freeloader.",
    diagram: false,
  },
];
const ASSESS = [
  { n: "Revert-grant", why: "Needs the chain to rewind a settled payment. Algorand finalises in ~3s and never rewinds, so the gap does not exist. On Ethereum the paper measured up to 5.18%." },
  { n: "Settlement preemption", why: "An Ethereum/Permit2 flaw. Our group is signed once and settled once; a thief who grabs it can only make the same payments land to the same providers." },
  { n: "Server selection", why: "Attacks open provider discovery. AXIS uses a fixed, first-party provider set — there is no discovery step to trick." },
];

/** Plain-language verdict for a finished attack. */
function verdict(r: AttackResult): { ok: boolean; line: string } {
  if (r.fired === 0) return { ok: false, line: `⚠ could not run — ${r.detail}` };
  if (r.fired > 1) {
    const ok = r.granted === 1;
    return { ok, line: ok
      ? `✅ ATTACK FAILED — the payment was used exactly ONCE; all ${r.blocked} copies were refused.`
      : `❌ VULNERABLE — one payment was used ${r.granted} times.` };
  }
  return { ok: r.blocked === 1, line: r.blocked === 1 ? `✅ ATTACK FAILED — ${r.detail}` : `❌ NOT BLOCKED — ${r.detail}` };
}

/** An inline diagram of the replay defence: 1 payment, 12 copies, 1 served, 11 refused. */
function ReplayDiagram({ r }: { r?: AttackResult }) {
  const granted = r ? r.granted : 1;
  const blocked = r ? r.blocked : 11;
  const live = !!r;
  return (
    <svg viewBox="0 0 420 210" width="100%" style={{ maxWidth: 460, background: "#0b0e13", borderRadius: 10, border: "1px solid #1c2530" }}>
      {/* one real payment */}
      <rect x="14" y="82" width="96" height="46" rx="9" fill="#1c1608" stroke="#f6c344" />
      <text x="62" y="102" fill="#f6c344" fontSize="11" fontWeight="700" textAnchor="middle">1 real</text>
      <text x="62" y="116" fill="#f6c344" fontSize="11" fontWeight="700" textAnchor="middle">payment</text>
      {/* fan of 12 copies into the gate */}
      {[70, 86, 98, 110, 122, 138].map((y, i) => (
        <line key={i} x1="110" y1="105" x2="176" y2={y} stroke="#63b3ff" strokeWidth="1.4" opacity="0.7" />
      ))}
      <text x="140" y="60" fill="#63b3ff" fontSize="10" textAnchor="middle">attacker fires ×12 copies</text>
      {/* the claim gate */}
      <rect x="176" y="70" width="86" height="70" rx="10" fill="#111a24" stroke="#2b3a4d" />
      <text x="219" y="98" fill="#cdd6e4" fontSize="10" fontWeight="700" textAnchor="middle">🛡 claim</text>
      <text x="219" y="112" fill="#8b98aa" fontSize="9" textAnchor="middle">seen this</text>
      <text x="219" y="123" fill="#8b98aa" fontSize="9" textAnchor="middle">payment?</text>
      {/* served (green) */}
      <line x1="262" y1="90" x2="316" y2="58" stroke="#4ade80" strokeWidth="1.8" />
      <rect x="316" y="36" width="92" height="46" rx="9" fill="#0f2519" stroke="#4ade80" />
      <text x="362" y="55" fill="#4ade80" fontSize="10" textAnchor="middle">✅ served</text>
      <text x="362" y="73" fill="#4ade80" fontSize="17" fontWeight="800" textAnchor="middle">{granted}</text>
      {/* refused (red) */}
      <line x1="262" y1="120" x2="316" y2="150" stroke="#f87171" strokeWidth="1.8" />
      <rect x="316" y="128" width="92" height="54" rx="9" fill="#241315" stroke="#f87171" />
      <text x="362" y="147" fill="#f87171" fontSize="10" textAnchor="middle">🚫 refused</text>
      <text x="362" y="166" fill="#f87171" fontSize="17" fontWeight="800" textAnchor="middle">{blocked}</text>
      <text x="362" y="178" fill="#b98" fontSize="8" textAnchor="middle">already used</text>
      {!live && <text x="219" y="158" fill="#55606e" fontSize="9" textAnchor="middle">(fire it to see the real numbers)</text>}
    </svg>
  );
}

export default function Attack() {
  const [results, setResults] = useState<Record<string, AttackResult | "running">>({});
  const [proof, setProof] = useState<string | null>(null); // pre-settled payment for replay

  const [demoRun, setDemoRun] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);

  // Real-payment attack demos remain disabled.
  const prime = () => api.primeAttack().then((p) => setProof(p.proof)).catch(() => setProof(null));


  const fire = async (id: string) => {
    setResults((r) => ({ ...r, [id]: "running" }));
    try {
      const res = await api.attack(id, id === "replay" ? proof ?? undefined : undefined);
      setResults((r) => ({ ...r, [id]: res }));
      if (id === "replay") { setProof(null); prime(); } // re-arm for the next click
    } catch (e) {
      setResults((r) => ({ ...r, [id]: { fired: 0, blocked: 0, granted: 0, mitigation: "", detail: `router offline (${String(e).slice(0, 40)})` } }));
    }
  };

  return (
    <main>
      <div className="dash-head">
        <h1>Start attack</h1>
        <span className="dim">
          Direct-payment attack demos disabled ·{" "}
          <a href="https://arxiv.org/abs/2605.11781" target="_blank" rel="noreferrer">arXiv:2605.11781</a>
        </span>
      </div>

      <section className="card" style={{ marginBottom: 24 }}>
        <h2>Live monitor demo · no payments</h2>
        <p>Open the AXIS extension and connect your account first. This plays simulated discovery, payment and refund events; no API calls or money move.</p>
        <button disabled={demoBusy} onClick={async () => {
          setDemoBusy(true); setDemoError(null);
          try { setDemoRun((await api.demo()).runId); }
          catch (error) { setDemoError((error as { error?: { message?: string } }).error?.message ?? "Could not start demo"); }
          finally { setDemoBusy(false); }
        }}>{demoBusy ? "Starting…" : "Start live demo"}</button>
        {demoRun && <p>Demo started — watch your extension, or <a href={`/runs/${demoRun}`}>open the live demo</a>. Displayed amounts are fictional.</p>}
        {demoError && <p role="alert">{demoError}</p>}
      </section>

      <div className="stat-row">
        <div className="stat"><div className="k">served = granted</div><div className="v ok">1</div><div className="k" style={{ marginTop: 6 }}>the one real use — correct</div></div>
        <div className="stat"><div className="k">refused = blocked</div><div className="v warn">11</div><div className="k" style={{ marginTop: 6 }}>copies turned away — the attack failing</div></div>
        <div className="stat"><div className="k">mitigated / total</div><div className="v">3 / 5</div><div className="k" style={{ marginTop: 6 }}>the other 2 are Ethereum-only</div></div>
      </div>

      {LIVE.map((a) => {
        const r = results[a.id];
        const done = r && r !== "running" ? (r as AttackResult) : undefined;
        const v = done ? verdict(done) : null;
        return (
          <div key={a.id} className="atk">
            <div className="atk-head">
              <h3>{a.n}</h3>
              <span className="dim">{a.tag}</span>
              <button onClick={() => fire(a.id)} disabled={r === "running"}>
                {r === "running" ? "firing…" : "fire attack"}
              </button>
            </div>
            <p className="atk-line"><b>The attack:</b> {a.what}</p>
            <p className="atk-line"><b>How we stop it:</b> {a.how}</p>
            {a.id === "replay" && !proof && r !== "running" ? <p className="dim atk-line">Direct-payment demo disabled; use the simulated live monitor above.</p> : null}
            {a.diagram ? <ReplayDiagram r={done} /> : null}
            {r === "running" ? <p className="dim atk-line">firing 12 real requests at the live endpoint…</p> : null}
            {done && v ? (
              <div className="atk-result">
                <span className={v.ok ? "pill pill-ok" : "pill pill-bad"}>{v.ok ? "attack failed" : "vulnerable"}</span>
                <span>{v.line.replace(/^[✅❌⚠]\s*/, "").replace(/^(ATTACK FAILED|VULNERABLE|NOT BLOCKED)\s*—\s*/, "")}</span>
                <span className="dim" style={{ marginLeft: "auto" }}>fired {done.fired} · served {done.granted} · refused {done.blocked}</span>
              </div>
            ) : null}
          </div>
        );
      })}

      <h2>Can&apos;t happen here on Algorand</h2>
      <div className="proj-grid">
        {ASSESS.map((a) => (
          <div key={a.n} className="card">
            <div className="nm" style={{ fontWeight: 640, marginBottom: 6 }}>{a.n}</div>
            <div className="dim" style={{ fontSize: 13 }}>{a.why}</div>
          </div>
        ))}
      </div>
    </main>
  );
}
