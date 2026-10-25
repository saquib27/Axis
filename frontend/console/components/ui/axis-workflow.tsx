"use client";

import { useEffect, useState } from "react";

/**
 * AxisWorkflow — a looping, cursor-driven walkthrough of one real run,
 * drawn as a single connected graph that fills the panel.
 *
 * Every node is mounted for the whole loop and only changes state; nothing
 * mounts or unmounts per scene. That is deliberate — if nodes appeared and
 * disappeared the layout would reflow and every edge would need re-routing,
 * so the connections would never read as stable wiring.
 *
 * viewBox is 960×930 (aspect ≈ 1.03) on purpose. The slot this sits in is
 * landscape on a short viewport and portrait on a tall one — measured at
 * 1.14 and 0.93 — so no fixed aspect can fill both. Sitting between them
 * keeps usage above ~90% in whichever dimension is the constrained one; a
 * portrait viewBox wasted a third of the width, and a wide one wasted a
 * quarter of the height.
 *
 * The run is real: prices are each provider's own `priceUSDC`, the fee is
 * ROUTING_FEE_MICRO, and 10-of-16 slots is nine payees plus the facilitator's
 * fee-payer slot. The last provider fails on purpose, because the refund
 * leg is the thing worth showing.
 *
 * Scene changes run on setTimeout, motion on CSS transition — decoupled, so
 * the sequence still advances where animation frames are throttled.
 */

type Scene = {
  id: string; label: string; dur: number;
  title: string; sub: string;
  cx: number; cy: number; click?: boolean;
  foot: string;
};

const SCENES: Scene[] = [
  { id: "pick", label: "workflow", dur: 2800, cx: 145, cy: 58, click: true,
    title: "Run a workflow", sub: "The CI pipeline asks for deep-review — nine paid endpoints.",
    foot: "9 workflows · nothing paid yet" },
  { id: "quote", label: "quote", dur: 3800, cx: 560, cy: 190,
    title: "Quote", sub: "The router probes all nine endpoints. Every price comes from its own 402.",
    foot: "9 challenges read · costs $0" },
  { id: "policy", label: "policy", dur: 3000, cx: 145, cy: 232,
    title: "Spend policy", sub: "Six rules run before a group is even built.",
    foot: "a failure here costs exactly $0" },
  { id: "sign", label: "sign", dur: 2800, cx: 145, cy: 268, click: true,
    title: "Authorise", sub: "Nine legs become one atomic group. One signature covers all of it.",
    foot: "10 of 16 slots · 9 payees + 1 fee payer" },
  { id: "settle", label: "settle", dur: 3200, cx: 300, cy: 530,
    title: "Settle", sub: "The group commits on Algorand — all of it, or none of it.",
    foot: "~3s finality · the agent never holds ALGO" },
  { id: "deliver", label: "deliver", dur: 3600, cx: 560, cy: 350,
    title: "Deliver", sub: "Eight providers return work. The ninth takes payment and fails.",
    foot: "payment atomicity is not delivery" },
  { id: "receipt", label: "receipt", dur: 5400, cx: 420, cy: 790, click: true,
    title: "Receipt", sub: "The failed leg is reversed on-chain and lands in one receipt.",
    foot: "one artifact · every txid still resolves" },
];

const PROV = [
  { n: "diff · explain", p: "/diff/explain", a: "0.03", tx: "K7X2…9QF", out: "312 tokens" },
  { n: "guardrail · check", p: "/guardrail/check", a: "0.02", tx: "M3B8…1LD", out: "risk 0.04" },
  { n: "commit · roast", p: "/commit/roast", a: "0.03", tx: "P9Z4…7TA", out: "5 rewrites" },
  { n: "summarize", p: "/summarize", a: "0.02", tx: "T5K9…2WQ", out: "TL;DR" },
  { n: "test · write", p: "/test/write", a: "0.04", tx: "J8L1…6RE", out: "7 cases" },
  { n: "code · generate", p: "/code/generate", a: "0.05", tx: "H4D7…8YU", out: "patch" },
  { n: "debug · fix", p: "/debug/fix", a: "0.04", tx: "N6F3…4XC", out: "2 fixes" },
  { n: "translate", p: "/translate", a: "0.02", tx: "Q1S8…5ZB", out: "plain English" },
  { n: "bug · summarize", p: "/bug/summarize", a: "0.05", tx: "R2C6…3VN", out: "502 — no result", fails: true },
];

/* Geometry in one place, so edges stay anchored to node edges. Nine rows fit
   the 402-tall provider box at a 42px pitch. */
const PH = 36;
const PY = PROV.map((_, i) => 40 + i * 42);
const PMID = PY.map((y) => y + PH / 2);

export function AxisWorkflow() {
  const [i, setI] = useState(0);
  const [clicking, setClicking] = useState(false);
  const s = SCENES[i];

  useEffect(() => {
    const next = setTimeout(() => setI((v) => (v + 1) % SCENES.length), s.dur);
    let a: ReturnType<typeof setTimeout> | undefined;
    let b: ReturnType<typeof setTimeout> | undefined;
    if (s.click) {
      a = setTimeout(() => setClicking(true), 950);
      b = setTimeout(() => setClicking(false), 1550);
    }
    return () => { clearTimeout(next); if (a) clearTimeout(a); if (b) clearTimeout(b); };
  }, [i, s]);

  const priced = i >= 1;
  const composed = i >= 3;
  const settled = i >= 4;
  const delivered = i >= 5;
  const done = i === 6;

  const provStatus = (k: number) => {
    const p = PROV[k];
    if (i === 0) return "";
    if (i === 1) return "402";
    if (i === 2) return "trust 90";
    if (i === 3) return `slot ${k + 1}`;
    if (i === 4) return "paid";
    return p.fails ? (i === 5 ? "reversing" : "reversed") : "delivered";
  };
  const provSub = (k: number) => (i <= 3 ? PROV[k].p : i === 4 ? PROV[k].tx : PROV[k].out);

  const routerSub = ["waiting for a workflow", "reading 402 challenges", "6 / 6 rules passed",
    "", "signed · settling", "compensating leg 4", "run complete"][i];

  return (
    <div className="auth-canvas animate-slide-right animate-delay-300">
      <div className="auth-canvas-bar">
        <span className="crumb">axis</span><span>/</span><span className="crumb">production</span>
        <span className="tab on">Runs</span>
        <span className="tab">Receipts</span>
        <span className="tab">Policy</span>
        <span className="live"><i />live</span>
      </div>

      <div className="auth-canvas-body" style={{ flexDirection: "column" }}>
        <div className="demo-rail">
          {SCENES.map((sc, k) => (
            <div key={sc.id}
              className={`demo-rail-step ${k < i ? "done" : ""} ${k === i ? "now" : ""}`}
              style={{ ["--dur" as string]: `${sc.dur}ms` }}>
              <div className="bar"><i /></div>
              <div className="lbl">{sc.label}</div>
            </div>
          ))}
        </div>

        <div className="demo-head">
          <h4>{s.title}</h4>
          <p>{s.sub}</p>
        </div>

        <div className="demo-graph">
          <svg viewBox="0 0 960 930" preserveAspectRatio="xMidYMid meet" role="img"
            aria-label={`Step ${i + 1} of 7: ${s.title}. ${s.sub}`}>
            <defs>
              <marker id="g-ar" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M 0 1 L 6 4 L 0 7" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.2" />
              </marker>
            </defs>

            {/* ── edges ─────────────────────────────────────────────── */}
            <path className={`g-edge ${i === 0 || i === 3 ? "live" : ""} ${settled ? "done" : ""}`}
              d="M 155 96 L 155 170" markerEnd="url(#g-ar)" />
            {PMID.map((y, k) => (
              <path key={k}
                className={`g-edge ${i === 1 || i === 2 ? "live" : ""} ${settled && !(PROV[k].fails && delivered) ? "done" : ""}`}
                d={`M 280 240 C 318 240, 324 ${y}, 356 ${y}`} />
            ))}
            <path className={`g-edge ${i === 4 ? "live" : ""} ${settled ? "done" : ""}`}
              d="M 155 310 L 155 470" markerEnd="url(#g-ar)" />
            <path className={`g-edge ${i === 4 ? "live" : ""} ${settled ? "done" : ""}`}
              d="M 643 402 L 643 470" markerEnd="url(#g-ar)" />
            <path className={`g-edge ${done ? "live" : ""}`}
              d="M 155 600 L 155 650" markerEnd="url(#g-ar)" />
            <path className={`g-edge ${delivered ? "refund" : ""}`} d="M 30 545 C 8 545, 8 250, 30 250" />
            <g className={`g-fade ${delivered ? "in" : ""}`}>
              <rect x={2} y={388} width={26} height={16} rx={4}
                fill="rgba(245,166,35,0.12)" stroke="rgba(245,166,35,0.4)" />
              <text className="g-tag" x={15} y={400} textAnchor="middle" fill="#f5a623">↩</text>
            </g>

            {/* ── CI pipeline ───────────────────────────────────────── */}
            <rect className={`g-node ${i === 0 || i === 3 ? "on" : "idle"}`} x={30} y={26} width={250} height={70} rx={11} />
            <text className="g-lbl" x={48} y={56}>CI pipeline</text>
            <text className="g-sub" x={48} y={78}>{i === 0 ? "pr-review selected" : "1 signature"}</text>

            {/* ── AXIS router ───────────────────────────────────────── */}
            <rect className={`g-node ${i >= 1 && i <= 3 ? "on" : done ? "done" : "idle"}`}
              x={30} y={170} width={250} height={140} rx={11} />
            <text className="g-lbl" x={48} y={204}>AXIS router</text>
            {i !== 3 && <text className="g-sub" x={48} y={228}>{routerSub}</text>}
            {i === 2 && (
              <g>
                {[0, 1, 2, 3, 4, 5].map((k) => (
                  <rect key={k} x={48 + k * 17} y={252} width={12} height={4} rx={2} fill="#50e3c2" opacity={0.85} />
                ))}
                <text className="g-sub" x={48} y={284} fill="#50e3c2">headroom $4.86</text>
              </g>
            )}
            {i === 3 && (
              <g>
                <rect className={`g-btn ${clicking ? "pressed" : ""}`} x={48} y={250} width={214} height={34} rx={8} />
                <text className="g-btn-txt" x={155} y={272} textAnchor="middle">Pay $0.31 · sign once</text>
              </g>
            )}

            {/* ── providers ─────────────────────────────────────────── */}
            <rect className={`g-group ${composed ? "formed" : ""}`} x={356} y={22} width={574} height={400} rx={14} />
            <text className="g-tag" x={374} y={48}>{composed ? "ATOMIC GROUP · 9 LEGS" : "PROVIDERS · x402"}</text>
            {PROV.map((p, k) => {
              const bad = p.fails && delivered;
              const ok = settled && !bad;
              return (
                <g key={p.n}>
                  <rect className={`g-node ${bad ? "bad" : ok ? "done" : priced ? "" : "idle"}`}
                    x={374} y={PY[k]} width={538} height={PH} rx={9} />
                  <text className="g-lbl" x={392} y={PY[k] + 23}>{p.n}</text>
                  <text className="g-sub" x={600} y={PY[k] + 23}>{provSub(k)}</text>
                  <text className={`g-amt ${bad ? "paid" : ok ? "ok" : ""}`} x={830} y={PY[k] + 23} textAnchor="end">
                    ${p.a}
                  </text>
                  <text className="g-tag" x={906} y={PY[k] + 23} textAnchor="end"
                    fill={bad ? "#f5a623" : ok ? "#50e3c2" : undefined}>
                    {provStatus(k)}
                  </text>
                </g>
              );
            })}

            {/* ── settlement ────────────────────────────────────────── */}
            <rect className={`g-group ${settled ? "formed" : ""}`} x={30} y={470} width={900} height={130} rx={14} />
            <text className="g-tag" x={48} y={496}>SETTLEMENT</text>
            <text className="g-tag" x={912} y={496} textAnchor="end">
              {settled ? "GROUP 7QP4…K2M9 · COMMITTED" : "ALL OR NOTHING"}
            </text>
            <rect className={`g-node ${settled ? "done" : "idle"}`} x={48} y={510} width={420} height={68} rx={10} />
            <text className="g-lbl" x={68} y={538}>Algorand testnet</text>
            <text className="g-sub" x={68} y={560}>{settled ? "settled in 2.9s" : "USDC ASA · ~3s finality"}</text>
            <rect className={`g-node ${settled ? "done" : "idle"}`} x={490} y={510} width={420} height={68} rx={10} />
            <text className="g-lbl" x={510} y={538}>GoPlausible</text>
            <text className="g-sub" x={510} y={560}>facilitator pays the fees</text>

            {/* ── receipt ───────────────────────────────────────────── */}
            <rect className={`g-node ${done ? "on" : "idle"}`} x={30} y={650} width={900} height={266} rx={14} />
            <text className="g-tag" x={48} y={678}>RECEIPT</text>
            <text className="g-tag" x={912} y={678} textAnchor="end" fill={done ? "#f5a623" : undefined}>
              {done ? "PARTIAL" : "PENDING"}
            </text>
            <g className={`g-fade ${done ? "in" : ""}`}>
              {PROV.map((p, k) => (
                <g key={p.n}>
                  <text className="g-sub" x={52} y={700 + k * 18} fill="#ededed">{p.n}</text>
                  <text className="g-sub" x={520} y={700 + k * 18}>{p.tx}</text>
                  <text className="g-amt" x={908} y={700 + k * 18} textAnchor="end"
                    fill={p.fails ? "#f5a623" : undefined}>${p.a}</text>
                </g>
              ))}
              <text className="g-sub" x={52} y={872} fill="#f5a623">↩ compensation</text>
              <text className="g-sub" x={520} y={872}>W8N1…5HJ</text>
              <text className="g-amt" x={908} y={872} textAnchor="end" fill="#f5a623">−$0.05</text>
              <line x1={48} y1={884} x2={912} y2={884} stroke="rgba(255,255,255,0.1)" />
              <text className="g-sub" x={52} y={902}>settled $0.31 · refunded $0.05</text>
              <text className="g-amt" x={908} y={902} textAnchor="end">net $0.26</text>
            </g>

            {/* ── cursor ────────────────────────────────────────────── */}
            <g className={`g-cursor ${clicking ? "clicking" : ""}`}
              style={{ transform: `translate(${s.cx}px, ${s.cy}px)` }} aria-hidden="true">
              <circle className="ring" cx={0} cy={0} r={5} />
              <path d="M0 0 L0 15 L4.2 11.2 L7 17 L10 15.6 L7.2 10 L12 9.6 Z"
                fill="#fff" stroke="#000" strokeWidth="1" strokeLinejoin="round" />
            </g>
          </svg>
        </div>
      </div>

      <div className="auth-canvas-foot">
        <span className="k">{s.foot}</span>
        <span style={{ marginLeft: "auto" }}>{i + 1} / {SCENES.length}</span>
      </div>
    </div>
  );
}
