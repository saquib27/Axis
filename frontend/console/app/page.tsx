"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ShaderBackground } from "../components/ui/shader-foda-rosa.tsx";
import { session } from "../lib/api.ts";

/* ── Brand mark ─────────────────────────────────────────────────────────
   Same ribbon geometry as asset/axis_logo.svg — only the gradient stops
   move. Monochrome: the back ribbon sinks to graphite, the front fold
   comes up to near-white, so the fold still reads without any hue.
   Gradient ids are suffixed so the mark can appear more than once per
   page without colliding. */
function Logo({ id = "a" }: { id?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" aria-hidden>
      <defs>
        <linearGradient id={`ax-back-${id}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6E6E76" />
          <stop offset="100%" stopColor="#2A2A2C" />
        </linearGradient>
        <linearGradient id={`ax-front-${id}`} x1="100%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="#C9C9CF" />
          <stop offset="100%" stopColor="#FFFFFF" />
        </linearGradient>
      </defs>
      <path d="M 453 200 L 203 820 L 821 450" fill="none" stroke={`url(#ax-back-${id})`} strokeWidth="140" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M 821 450 L 703 820 L 453 200" fill="none" stroke={`url(#ax-front-${id})`} strokeWidth="140" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Line glyphs ────────────────────────────────────────────────────────
   Drawn rather than pulled from an emoji font: emoji render differently on
   every OS and read as filler. 18px, 1.3 stroke, currentColor. */
const G = { width: 19, height: 19, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const GLYPH = {
  link: <svg {...G}><path d="M9.5 14.5 14.5 9.5" /><path d="M11 6.5 12.8 4.7a3.8 3.8 0 0 1 5.4 5.4L16.4 12" /><path d="M13 17.5l-1.8 1.8a3.8 3.8 0 0 1-5.4-5.4L7.6 12" /></svg>,
  undo: <svg {...G}><path d="M4 9h11a5 5 0 0 1 0 10h-6" /><path d="M8 5 4 9l4 4" /></svg>,
  shield: <svg {...G}><path d="M12 3.5 5 6.3v5.1c0 4.2 2.9 7.6 7 9.1 4.1-1.5 7-4.9 7-9.1V6.3z" /><path d="M9.3 12.2l1.9 1.9 3.6-3.7" /></svg>,
  receipt: <svg {...G}><path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z" /><path d="M9 8.5h6" /><path d="M9 12.5h6" /></svg>,
  lock: <svg {...G}><rect x="4.8" y="10.5" width="14.4" height="9.5" rx="2" /><path d="M8.2 10.5V7.8a3.8 3.8 0 0 1 7.6 0v2.7" /></svg>,
  key: <svg {...G}><circle cx="8" cy="12" r="3.6" /><path d="M11.6 12H20" /><path d="M17 12v3" /><path d="M14 12v2.2" /></svg>,
};

/* ── Hero canvas ────────────────────────────────────────────────────────
   The architecture as a stable board: agent → router → every service held
   inside one group container. Nothing jumps; only the wires breathe.
   These are the real nine providers and their real 402 prices — the same
   set `deep-review` settles in one group. */
const HERO_PROVIDERS = [
  { name: "diff · explain", price: "0.03" },
  { name: "guardrail · check", price: "0.02" },
  { name: "commit · roast", price: "0.03" },
  { name: "bug · summarize", price: "0.05" },
  { name: "summarize", price: "0.02" },
  { name: "test · write", price: "0.04" },
  { name: "code · generate", price: "0.05" },
  { name: "debug · fix", price: "0.04" },
  { name: "translate", price: "0.02" },
];
/* Row pitch and the first row's centre, so wires and boxes stay in step. */
const HP_PITCH = 30, HP_TOP = 40;

function HeroCanvas() {
  return (
    <div className="lp-canvas reveal d1">
      <div className="lp-canvas-bar">
        <span className="seg">workflow / deep-review</span>
        <span className="seg">testnet</span>
        <span className="spacer" />
        <span className="seg">group 10/16</span>
      </div>
      <div className="lp-canvas-inner">
        <svg viewBox="0 0 860 320" role="img" aria-label="A CI agent signs once; the AXIS router pays nine providers inside a single atomic group.">
          {/* group container */}
          <rect className="nd-group" x="486" y="10" width="360" height="300" rx="12" />
          <text className="nd-grouplbl" x="502" y="30">ATOMIC GROUP · ALL OR NOTHING</text>

          {/* wires */}
          <path className="nd-wire" d="M 176 160 L 250 160" />
          {HERO_PROVIDERS.map((_, i) => (
            <path key={i} className="nd-wire live" d={`M 414 160 C 448 160, 452 ${HP_TOP + 14 + i * HP_PITCH}, 486 ${HP_TOP + 14 + i * HP_PITCH}`} />
          ))}
          <circle className="nd-dot" r="2.6">
            <animateMotion dur="2.6s" repeatCount="indefinite" path="M 176 160 L 250 160" />
          </circle>

          {/* agent */}
          <rect className="nd-box" x="20" y="130" width="156" height="60" rx="10" />
          <text className="nd-title" x="38" y="156">CI pipeline</text>
          <text className="nd-meta" x="38" y="175">signs once</text>

          {/* router */}
          <rect className="nd-box accent" x="250" y="122" width="164" height="76" rx="10" />
          <text className="nd-title" x="270" y="152" style={{ fill: "#fff" }}>AXIS router</text>
          <text className="nd-meta" x="270" y="171">quote · policy · settle</text>
          <text className="nd-meta" x="270" y="187" style={{ fill: "#d4d4d9" }}>fee $0.01</text>

          {/* providers */}
          {HERO_PROVIDERS.map((p, i) => (
            <g key={p.name}>
              <rect className="nd-box" x="502" y={HP_TOP + i * HP_PITCH} width="328" height="26" rx="7" />
              <text className="nd-title" x="518" y={HP_TOP + 17 + i * HP_PITCH}>{p.name}</text>
              <text className="nd-price" x="726" y={HP_TOP + 17 + i * HP_PITCH} textAnchor="end">{p.price} USDC</text>
              <text className="nd-meta" x="814" y={HP_TOP + 17 + i * HP_PITCH} textAnchor="end">402</text>
            </g>
          ))}
        </svg>
      </div>
      <div className="lp-stage-foot">
        <span className="k">1 signature</span><span className="sep">/</span>
        <span className="k">9 payees</span><span className="sep">/</span>
        <span className="k">$0.31 total</span><span className="sep">/</span>
        <span className="k">1 receipt</span>
        <span style={{ marginLeft: "auto" }} className="ok">commits or rejects as one unit</span>
      </div>
    </div>
  );
}

/* ── Protocol: the six phases, and what the stage shows at each ───────── */
const PHASES = [
  {
    t: "Discover & quote",
    d: "The router fans out unpaid probes and reads each provider's own 402 challenge — prices are never hardcoded. The dependency DAG resolves into parallel batches and the total is signed into a quote with a 120-second TTL.",
    cost: "costs $0",
    free: true,
  },
  {
    t: "Policy gate",
    d: "Before anything is composed, the spend guard evaluates six rules: kill switch, per-workflow ceiling, per-provider cap, hourly spend velocity, call velocity, and provider trust. A failure stops the run before a group exists.",
    cost: "costs $0",
    free: true,
  },
  {
    t: "Compose the group",
    d: "One Algorand atomic group is built with one USDC transfer leg per payee, plus the facilitator as fee payer. Fifteen provider legs is the ceiling; the sixteenth slot belongs to fees.",
    cost: "costs $0",
    free: true,
  },
  {
    t: "Simulate",
    d: "simulateTransactions dry-runs the entire group against live chain state — balances, opt-ins, fees — for free. A group that would fail is rejected here, before a single microAlgo has moved.",
    cost: "costs $0",
    free: true,
  },
  {
    t: "Sign & settle",
    d: "A single signature authorizes the whole workflow. The group commits all-or-nothing in roughly three seconds, and the agent's wallet never needs to hold ALGO — the facilitator co-signs as fee payer.",
    cost: "settles $0.13",
    free: false,
  },
  {
    t: "Execute & compensate",
    d: "Each provider is called again with its settlement proof. Payment atomicity is not delivery: a provider that takes payment and then fails has its leg reversed on-chain, the run is marked PARTIAL, and the refund txid lands in the receipt.",
    cost: "refunds $0.05",
    free: false,
  },
];

const STAGE_PROVIDERS = [
  { name: "diff · explain", price: "0.03", tx: "K7X2…9QF", out: "312 tokens" },
  { name: "guardrail · check", price: "0.02", tx: "M3B8…1LD", out: "risk 0.04" },
  { name: "commit · roast", price: "0.03", tx: "P9Z4…7TA", out: "5 rewrites" },
  { name: "summarize", price: "0.02", tx: "T5K9…2WQ", out: "TL;DR ready" },
  { name: "test · write", price: "0.04", tx: "J8L1…6RE", out: "7 cases" },
  { name: "code · generate", price: "0.05", tx: "H4D7…8YU", out: "patch ready" },
  { name: "debug · fix", price: "0.04", tx: "N6F3…4XC", out: "2 fixes" },
  { name: "translate", price: "0.02", tx: "Q1S8…5ZB", out: "plain English" },
  { name: "bug · summarize", price: "0.05", tx: "R2C6…3VN", out: "502 — no result", fails: true },
];

/* Row geometry for the protocol stage — nine rows inside a 360-tall board. */
const SP_TOP = 42, SP_H = 30, SP_PITCH = 34;

const STAGE_FOOT: Array<Array<{ v: string; c?: string }>> = [
  [{ v: "9 challenges read" }, { v: "$0.31 quoted" }, { v: "spent $0", c: "ok" }],
  [{ v: "6/6 checks passed", c: "ok" }, { v: "ceiling $5.00" }, { v: "headroom $4.69" }],
  [{ v: "10 / 16 slots" }, { v: "9 payees" }, { v: "1 fee payer" }],
  [{ v: "simulation ok", c: "ok" }, { v: "opt-ins ✓" }, { v: "0 fees paid", c: "ok" }],
  [{ v: "1 signature" }, { v: "settled in 2.9s", c: "ok" }, { v: "9 txids" }],
  [{ v: "PARTIAL", c: "warn" }, { v: "8 delivered", c: "ok" }, { v: "1 refunded on-chain", c: "warn" }],
];

function ProtocolStage({ step }: { step: number }) {
  const composed = step >= 2;
  const settled = step >= 4;
  const delivering = step === 5;

  return (
    <div className="lp-stage">
      <div className="lp-stage-head">
        <span>run / pr-review</span>
        <span className="live"><i />phase {step + 1} of 6</span>
      </div>
      <div className="lp-stage-body">
        <svg viewBox="0 0 520 360" role="img" aria-label={`Protocol phase ${step + 1}: ${PHASES[step].t}`}>
          {/* group container */}
          <rect className={`nd-group ${composed ? "formed" : ""}`} x="192" y="12" width="320" height="336" rx="12" />
          <text className="nd-grouplbl" x="206" y="32">
            {composed ? "ATOMIC GROUP · COMPOSED" : "PROVIDERS · UNPAID"}
          </text>

          {/* agent → router */}
          <path className={`nd-wire ${step === 4 ? "live" : ""}`} d="M 78 80 L 78 148" />
          {/* router → receipt */}
          <path className={`nd-wire st-el ${delivering ? "on settled" : "dim"}`} d="M 78 212 L 78 276" />

          {/* policy gate — sits on the path, only while the guard is running */}
          <g className={`st-el ${step === 1 ? "on" : ""}`}>
            <line x1="170" y1="120" x2="170" y2="240" stroke="rgba(255,255,255,0.42)" strokeWidth="1" strokeDasharray="3 4" />
            <text className="nd-meta" x="170" y="112" textAnchor="middle" style={{ fill: "#d4d4d9" }}>policy gate</text>
          </g>

          {/* router → providers */}
          {STAGE_PROVIDERS.map((_, i) => {
            const y = SP_TOP + SP_H / 2 + i * SP_PITCH;
            const live = step === 0 || step === 4;
            const done = settled && !(delivering && STAGE_PROVIDERS[i].fails);
            return (
              <path
                key={i}
                className={`nd-wire ${live ? "live" : ""} ${done ? "settled" : ""}`}
                d={`M 148 180 C 172 180, 176 ${y}, 192 ${y}`}
              />
            );
          })}

          {/* refund leg — the differentiator, drawn only when it happens */}
          <g className={`st-el ${delivering ? "on" : ""}`}>
            <path className="nd-wire reverse" d="M 192 292 C 176 292, 172 180, 148 180" />
            <text className="nd-meta" x="164" y="312" textAnchor="middle" style={{ fill: "#9a9aa2" }}>refund</text>
          </g>

          {/* agent */}
          <rect className={`nd-box ${step === 4 ? "live" : ""}`} x="8" y="28" width="140" height="52" rx="9" />
          <text className="nd-title" x="24" y="50">CI pipeline</text>
          <text className="nd-meta" x="24" y="67">{step >= 4 ? "signed ✓" : "awaiting quote"}</text>

          {/* router */}
          <rect className={`nd-box ${step <= 3 ? "accent" : ""} ${step === 1 || step === 2 ? "live" : ""}`} x="8" y="148" width="140" height="64" rx="9" />
          <text className="nd-title" x="24" y="174" style={{ fill: "#fff" }}>AXIS router</text>
          <text className="nd-meta" x="24" y="192">{PHASES[step].t.toLowerCase()}</text>

          {/* receipt */}
          <rect className={`nd-box st-el ${delivering ? "on settled" : "dim"}`} x="8" y="276" width="140" height="52" rx="9" />
          <text className={`nd-title st-el ${delivering ? "on" : "dim"}`} x="24" y="298">Receipt</text>
          <text className={`nd-meta st-el ${delivering ? "on" : "dim"}`} x="24" y="315">1 group · 5 txids</text>

          {/* providers */}
          {STAGE_PROVIDERS.map((p, i) => {
            const y = SP_TOP + i * SP_PITCH;
            const reversed = delivering && p.fails;
            const ok = settled && !reversed;
            const mid = y + SP_H / 2 + 4;
            return (
              <g key={p.name}>
                <rect className={`nd-box ${ok ? "settled" : ""} ${reversed ? "reversed" : ""}`} x="206" y={y} width="292" height={SP_H} rx="7" />
                <text className="nd-title" x="220" y={mid}>{p.name}</text>
                <text className="nd-price" x="404" y={mid} textAnchor="end">
                  {composed ? `${i + 1} · ` : ""}{p.price}
                </text>
                <text
                  className="nd-meta"
                  x="484"
                  y={mid}
                  textAnchor="end"
                  style={{ fill: reversed ? "#9a9aa2" : ok ? "#ffffff" : undefined }}
                >
                  {step === 0 ? "402" : step === 1 ? "trust 90" : step === 2 ? "queued" : step === 3 ? "✓ sim" : reversed ? "reversed" : delivering ? p.out : "paid"}
                </text>
              </g>
            );
          })}

          {/* simulation sweep */}
          <line className={`st-scan st-el ${step === 3 ? "on" : ""}`} x1="192" y1="20" x2="512" y2="20" />
        </svg>
      </div>
      <div className="lp-stage-foot">
        {STAGE_FOOT[step].map((f, i) => (
          <span key={f.v} style={{ display: "contents" }}>
            {i > 0 && <span className="sep">/</span>}
            <span className={f.c ?? "k"}>{f.v}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

const ADDS = [
  { g: GLYPH.link, s: "s3", t: "Multi-endpoint atomicity", d: "N payment legs to N different provider addresses commit or reject as one Algorand group. No escrow contract to write, no partial spends, no reconciliation queue to babysit.", tag: "no smart contract" },
  { g: GLYPH.undo, s: "s3", t: "Compensation on failure", d: "Payment atomicity is not delivery. A provider that takes payment and then fails gets its leg reversed on-chain, the run marked PARTIAL, and the refund txid written into the receipt.", tag: "on-chain refund" },
  { g: GLYPH.shield, s: "s2", t: "Pre-flight spend policy", d: "Ceilings, per-provider caps, hourly velocity limits and a kill switch, all evaluated before anything is signed. A violation costs zero.", tag: "before signature" },
  { g: GLYPH.receipt, s: "s2", t: "One unified receipt", d: "One artifact maps group id to every txid, every result, the total and the status. Open it cold months later and each transaction still resolves.", tag: "group-linked" },
  { g: GLYPH.lock, s: "s2", t: "Replay-hardened", d: "Resource binding, freshness windows and single-use claims run in strict order, backed by a linearizable Durable Object.", tag: "arXiv:2605.11781" },
];

/* ── The real catalogue ─────────────────────────────────────────────────
   Mirrors backend/router/src/workflows/pr-review.ts and the providers'
   own priceUSDC. Prices are in cents so the arithmetic here stays integer,
   matching the bigint microUSDC discipline on the backend. Nine paid
   endpoints across five payout addresses — the toolbox Worker hosts five
   of them and settles them all to PAY_TO_TOOLBOX. */
const ENDPOINTS: Record<string, { name: string; cents: number; payee: string }> = {
  diff: { name: "diff · explain", cents: 3, payee: "PAY_TO_DIFF" },
  guardrail: { name: "guardrail · check", cents: 2, payee: "PAY_TO_GUARDRAIL" },
  roast: { name: "commit · roast", cents: 3, payee: "PAY_TO_ROASTER" },
  bugsum: { name: "bug · summarize", cents: 5, payee: "PAY_TO_BUGSUM" },
  codegen: { name: "code · generate", cents: 5, payee: "PAY_TO_TOOLBOX" },
  debug: { name: "debug · fix", cents: 4, payee: "PAY_TO_TOOLBOX" },
  tests: { name: "test · write", cents: 4, payee: "PAY_TO_TOOLBOX" },
  translate: { name: "translate", cents: 2, payee: "PAY_TO_TOOLBOX" },
  summarize: { name: "summarize", cents: 2, payee: "PAY_TO_TOOLBOX" },
};

const ROUTING_FEE_CENTS = 1;

/** Batches are the DAG's parallel levels: batch 2 depends on batch 1. */
const CATALOGUE = [
  { id: "pr-review", group: "Composed", batches: [["diff", "guardrail", "roast"], ["bugsum"]] },
  { id: "bug-hunt", group: "Composed", batches: [["diff"], ["bugsum"]] },
  { id: "security-scan", group: "Composed", batches: [["guardrail"]] },
  { id: "commit-polish", group: "Composed", batches: [["roast"]] },
  { id: "generate-code", group: "Toolbox", batches: [["codegen"]] },
  { id: "debug-error", group: "Toolbox", batches: [["debug"]] },
  { id: "write-tests", group: "Toolbox", batches: [["tests"]] },
  { id: "translate-text", group: "Toolbox", batches: [["translate"]] },
  { id: "summarize-text", group: "Toolbox", batches: [["summarize"]] },
];

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function Composer() {
  const [pick, setPick] = useState(0);
  const [failing, setFailing] = useState(false);
  const [touched, setTouched] = useState(false);

  /* Cycles on its own so the section is alive on arrival, and stops for
     good the moment the reader takes over. */
  useEffect(() => {
    if (touched) return;
    const t = setInterval(() => setPick((p) => (p + 1) % CATALOGUE.length), 3400);
    return () => clearInterval(t);
  }, [touched]);

  const take = (fn: () => void) => { setTouched(true); fn(); };

  const wf = CATALOGUE[pick];
  const steps = wf.batches.flat();
  const providerCents = steps.reduce((n, s) => n + ENDPOINTS[s].cents, 0);
  const payees = new Set(steps.map((s) => ENDPOINTS[s].payee)).size;
  const slots = steps.length + 1; // provider legs + the facilitator's fee-payer slot
  const lastIdx = steps.length - 1;
  const refundCents = failing ? ENDPOINTS[steps[lastIdx]].cents : 0;

  let slotNo = 0;

  return (
    <div className="lp-lab">
      <div className="lp-lab-rail">
        {["Composed", "Toolbox"].map((g) => (
          <div className="grp" key={g} style={{ display: "contents" }}>
            <h4>{g === "Composed" ? "Composed workflows" : "Toolbox · one payee"}</h4>
            {CATALOGUE.map((w, i) =>
              w.group !== g ? null : (
                <button
                  key={w.id}
                  type="button"
                  className="lp-chip"
                  aria-pressed={pick === i}
                  onClick={() => take(() => setPick(i))}
                >
                  {w.id}
                  <span className="n">{w.batches.flat().length}</span>
                </button>
              )
            )}
          </div>
        ))}
      </div>

      <div className="lp-lab-panel">
        <div className="lp-lab-head">
          <b>{wf.id}</b>
          <span className="sep">/</span>
          <span>{steps.length} {steps.length === 1 ? "leg" : "legs"}</span>
          <span className="sep">/</span>
          <span>{payees} {payees === 1 ? "payee" : "payees"}</span>
          <span className="sep">/</span>
          <span>{wf.batches.length} {wf.batches.length === 1 ? "batch" : "batches"}</span>
        </div>

        <div className="lp-lab-body">
          {wf.batches.map((batch, bi) => (
            <div className="lp-batch" key={bi}>
              <div className="lp-batch-lbl">
                batch {bi + 1}
                {bi > 0
                  ? ` · waits on batch ${bi}`
                  : batch.length > 1
                    ? ` · ${batch.length} run in parallel`
                    : ""}
              </div>
              {batch.map((s) => {
                slotNo += 1;
                const e = ENDPOINTS[s];
                const isReversed = failing && s === steps[lastIdx];
                return (
                  <div
                    className={`lp-leg ${isReversed ? "reversed" : ""}`}
                    key={s}
                    style={{ animationDelay: `${slotNo * 55}ms` }}
                  >
                    <span className="slot">{String(slotNo).padStart(2, "0")}</span>
                    <span className="nm">{e.name}</span>
                    <span className="payee">{e.payee.replace("PAY_TO_", "").toLowerCase()}</span>
                    <span className="amt">{usd(e.cents)}</span>
                  </div>
                );
              })}
            </div>
          ))}

          <div className="lp-slots" aria-label={`${slots} of 16 group slots used`}>
            {Array.from({ length: 16 }, (_, i) => (
              <span
                key={i}
                className={`lp-slot ${i < steps.length ? "used" : i === steps.length ? "fee" : ""}`}
              />
            ))}
          </div>
        </div>

        <div className="lp-lab-foot">
          <span>{slots}/16 slots</span>
          <span className="sep">/</span>
          <span>providers {usd(providerCents)}</span>
          <span className="sep">/</span>
          <span>fee {usd(ROUTING_FEE_CENTS)}</span>
          <span className="sep">/</span>
          <span className="tot">
            {failing
              ? `net ${usd(providerCents + ROUTING_FEE_CENTS - refundCents)}`
              : `total ${usd(providerCents + ROUTING_FEE_CENTS)}`}
          </span>
          <button
            type="button"
            className="lp-toggle"
            aria-pressed={failing}
            onClick={() => take(() => setFailing((f) => !f))}
          >
            <span className="box" />
            fail the last provider
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Minimal tokeniser ──────────────────────────────────────────────────
   Enough highlighting to make three static snippets legible, without
   pulling a syntax-highlighting dependency into a marketing page. Order
   matters: comments and strings must win before keywords can match. */
const TOKENS = /(\/\/[^\n]*|#[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(const|await|async|import|from|export|return|new|if|type|npx)\b|\b(\d+\.\d+|\d+)\b/g;

function highlight(src: string) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKENS.lastIndex = 0;
  while ((m = TOKENS.exec(src))) {
    if (m.index > last) out.push(src.slice(last, m.index));
    const cls = m[1] ? "c" : m[2] ? "s" : m[3] ? "k" : "n";
    out.push(<span className={cls} key={m.index}>{m[0]}</span>);
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push(src.slice(last));
  return out;
}

const SNIPPETS = [
  {
    id: "sdk",
    label: "axis-pay",
    foot: ["zero dependencies", "3.1 kB gzipped", "no private key"],
    code: `import { createAxisClient } from "axis-pay";

const axis = createAxisClient({ apiKey: process.env.AXIS_KEY });

// Phase 1 — prices come from each provider's own 402. Costs $0.
const quote = await axis.quote({
  workflow: "pr-review",
  inputs: { repo: "acme/api", diff },
});

quote.total;        // "0.14"
quote.legs.length;  // 4

// Phase 2 — one signature settles every leg, or none.
const receipt = await axis.pay(quote.id);

if (receipt.status === "PARTIAL") {
  // Took payment, then failed. Already reversed on-chain.
  receipt.refunds; // [{ provider: "bug-summarizer", txid: … }]
}`,
  },
  {
    id: "mcp",
    label: "mcp server",
    foot: ["Claude Desktop", "Cursor", "Claude Code"],
    code: `// ~/.claude/mcp.json — AXIS becomes tools your agent can call.
{
  "mcpServers": {
    "axis": {
      "command": "npx",
      "args": ["-y", "@axis/mcp"],
      "env": { "AXIS_KEY": "sk_live_..." }
    }
  }
}

// list_workflows   what can be run, and what each costs
// quote_workflow   price it without paying anything
// pay_and_run      settle atomically, return every result
// run_agent        hand it a plain-English task
// list_projects    spend, grouped by project
// create_project   group runs under a project`,
  },
  {
    id: "agent",
    label: "autonomous agent",
    foot: ["budget enforced twice", "refuses when nothing fits"],
    code: `$ npx @axis/agent run \\
    --goal "review PR 412 and flag anything risky" \\
    --budget 0.50

  matched workflow   deep-review
  quoted             $0.31  across 9 providers
  policy             6/6 checks passed, headroom $4.69
  simulated          ok, 0 fees paid
  settled            1 signature, 2.9s
  delivered          8 of 9
  reversed           $0.05 refunded on-chain

  spent $0.26 of $0.50 budget`,
  },
];

/* The five attacks from arXiv:2605.11781, and where each is stopped. */
const ATTACKS = [
  { n: "01", nm: "Payment replay", d: "The same settlement proof presented twice to bank two results for one payment.", st: "single-use claim" },
  { n: "02", nm: "Resource substitution", d: "A proof bought for a cheap endpoint redeemed against an expensive one.", st: "resource binding" },
  { n: "03", nm: "Stale challenge reuse", d: "An old 402 replayed long after its price or terms have moved on.", st: "freshness window" },
  { n: "04", nm: "Response cache poisoning", d: "A paid response cached by an intermediary and served to somebody who never paid.", st: "no-store · Vary" },
  { n: "05", nm: "Concurrent replay flood", d: "The same proof fired at many workers at once, racing the claim check.", st: "linearizable DO" },
];

const RECEIPT_LEGS = [
  { p: "diff · explain", a: "0.03", tx: "K7X2…9QF", s: "delivered", ok: true },
  { p: "guardrail · check", a: "0.02", tx: "M3B8…1LD", s: "delivered", ok: true },
  { p: "commit · roast", a: "0.03", tx: "P9Z4…7TA", s: "delivered", ok: true },
  { p: "bug · summarize", a: "0.05", tx: "R2C6…3VN", s: "reversed", ok: false },
];

const FAQ = [
  { q: "What happens if the group fails to commit?", a: "Nothing settles. An Algorand atomic group either commits in full or is rejected in full, so a failure at submission leaves every balance exactly where it was. The run is marked FAILED and the error carries costedNothing: true." },
  { q: "Does my agent need to hold ALGO?", a: "No. The facilitator co-signs the group as fee payer, so the agent wallet only ever needs USDC. This is a property of Algorand's fee-payer abstraction rather than something AXIS emulates." },
  { q: "A provider took payment and then went down. Now what?", a: "That is the case AXIS exists for. Payment atomicity is not delivery, so the router issues a compensating transfer from that provider's payee account back to the agent, marks the run PARTIAL, and writes the refund txid into the receipt beside the original payment." },
  { q: "Is the router custodial?", a: "Yes, deliberately. The router holds the signing key so that no client — SDK, MCP server, CLI agent or console — ever touches one. Signing lives in exactly one auditable place, and a leaked client credential cannot move funds." },
  { q: "How many providers can one workflow span?", a: "Fifteen. An Algorand atomic group holds sixteen transactions and the last slot belongs to the fee payer. Workflows wider than that are split across groups, which gives up cross-group atomicity, so AXIS rejects them rather than pretending otherwise." },
  { q: "Is this on mainnet?", a: "Not yet — everything runs against Algorand testnet with real USDC ASA transfers. The network is a single CAIP-2 constant, so mainnet is a configuration change rather than a rewrite." },
];

const WHY = [
  { v: "≤16", k: "Transactions per atomic group — all commit or all reject, natively, with no contract to audit." },
  { v: "~3s", k: "Deterministic finality. Settlement completes inside a single button press." },
  { v: "$0", k: "simulateTransactions validates the whole group against live state before anything moves." },
  { v: "USDC", k: "The facilitator co-signs as fee payer, so an agent wallet holds only USDC — never ALGO." },
];

function CodeTabs() {
  const [tab, setTab] = useState(0);
  const snip = SNIPPETS[tab];
  return (
    <div className="lp-code">
      <div className="lp-code-tabs" role="tablist" aria-label="Integration examples">
        {SNIPPETS.map((s, i) => (
          <button
            key={s.id}
            role="tab"
            type="button"
            aria-selected={tab === i}
            className="lp-code-tab"
            onClick={() => setTab(i)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <pre className="lp-code-body"><code>{highlight(snip.code)}</code></pre>
      <div className="lp-code-foot">
        {snip.foot.map((f, i) => (
          <span key={f} style={{ display: "contents" }}>
            {i > 0 && <span style={{ color: "var(--faint)" }}>/</span>}
            <span>{f}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Landing() {
  const [scrolled, setScrolled] = useState(false);
  const [step, setStep] = useState(0);
  // Read on the client only — localStorage doesn't exist during SSR, and the
  // first paint must match the server's markup.
  const [signedIn, setSignedIn] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const stepRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => { setSignedIn(!!session.token()); }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* Scroll reveal + protocol step tracking share one pass, throttled by
     timestamp rather than requestAnimationFrame: rAF is starved whenever the
     page isn't compositing (a background tab, an off-screen preview pane),
     which would pin the diagram to phase one. Measuring six rects on a
     scroll event is cheap, and browsers already coalesce scroll to frame
     rate. Rect-based rather than IntersectionObserver for the same reason. */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let last = 0;

    const measure = () => {
      const trigger = window.innerHeight * 0.88;
      root.querySelectorAll<HTMLElement>(".reveal:not(.in)").forEach((el) => {
        if (el.getBoundingClientRect().top < trigger) el.classList.add("in");
      });

      const mid = window.innerHeight * 0.5;
      let best = 0;
      let bestDist = Infinity;
      stepRefs.current.forEach((el, i) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        const dist = Math.abs(r.top + r.height / 2 - mid);
        if (dist < bestDist) { bestDist = dist; best = i; }
      });
      setStep(best);
    };

    const onScroll = () => {
      const now = Date.now();
      if (now - last < 50) return;
      last = now;
      measure();
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    // Never leave content invisible if a scroll event never arrives.
    const safety = setTimeout(() => root.querySelectorAll(".reveal").forEach((el) => el.classList.add("in")), 2000);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      clearTimeout(safety);
    };
  }, []);

  return (
    <div className="landing" ref={rootRef}>
{/* Background: white lights drifting behind a perforated black sheet, so
          the field stays a true #000 and only the dots ever light up. */}
      <div className="lp-lights" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className="lp-mesh" aria-hidden="true" />
      <div className="lp-vignette" aria-hidden="true" />
      {/* Flow-field shader behind the hero, the way railway.com sits an image
          behind theirs. Scrolls away with the hero rather than following. */}
      <div className="lp-shader" aria-hidden="true">
        <ShaderBackground className="h-full w-full" />
      </div>
      <div className="lp-grain" aria-hidden="true" />

      <header className={`lp-nav ${scrolled ? "scrolled" : ""}`}>
        <div className="lp-container">
          <Link href="/" className="lp-brand"><Logo id="nav" />AXIS</Link>
          <nav className="lp-nav-links">
            <a href="#protocol">Protocol</a>
            <a href="#platform">Platform</a>
            <a href="#integrate">Docs</a>
            <a href="#security">Security</a>
            <a href="#pricing">Pricing</a>
          </nav>
          <div className="lp-nav-actions">
            {signedIn ? (
              <Link href="/projects" className="lp-btn lp-btn-primary">Open console</Link>
            ) : (
              <>
                <Link href="/login" className="lp-btn lp-btn-quiet">Sign in</Link>
                <Link href="/signup" className="lp-btn lp-btn-primary">Get started</Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="lp-hero">
        <div className="lp-container lp-center">
          <span className="lp-pill reveal"><span className="dot" />Live on Algorand testnet · <b>x402 settlement</b></span>
          <h1 className="lp-display reveal">
            Many x402 endpoints.<br />One atomic pipeline.
          </h1>
          <p className="lp-sub reveal d1">
            AXIS settles N paid API calls as a single atomic group on Algorand. One signature, one
            receipt — and an automatic on-chain refund when a provider takes payment but fails to deliver.
          </p>
          <div className="lp-cta reveal d2">
            <Link href="/signup" className="lp-btn lp-btn-primary lp-btn-lg">Start building</Link>
            <a href="#protocol" className="lp-btn lp-btn-ghost lp-btn-lg">Read the protocol</a>
          </div>
          <div className="lp-note reveal d3">no subscription · no seats · $0.01 per run</div>
          <HeroCanvas />
        </div>
      </section>

      {/* TRUST */}
      <div className="lp-trust">
        <div className="lp-container lp-trust-inner">
          <span><b>Algorand</b> atomic groups</span>
          <span><b>x402</b> HTTP payments</span>
          <span><b>USDC</b> ASA settlement</span>
          <span><b>GoPlausible</b> facilitator</span>
          <span><b>Cloudflare</b> provider workers</span>
        </div>
      </div>

      {/* PROBLEM */}
      <section className="lp-section">
        <div className="lp-container lp-split">
          <div className="reveal">
            <div className="lp-eyebrow">The gap</div>
            <h2 className="lp-h2">Per-call payments don't compose.</h2>
            <p className="lp-lead">
              x402 solved the single call — hit an endpoint, take the 402, sign, retry, get data. But real
              agent work fans out across five, ten, twenty paid endpoints owned by different providers. That
              means N signatures, N unrelated payments and N orphaned receipts. When step four fails, steps
              one through three are already paid for.
            </p>
          </div>
          <div className="lp-ledger reveal d1">
            {[
              ["diff · explain", "paid $0.03"],
              ["guardrail · check", "paid $0.02"],
              ["commit · roast", "paid $0.03"],
            ].map(([n, s]) => (
              <div className="lp-ledger-row paid" key={n}>{n}<span className="st">{s}</span></div>
            ))}
            <div className="lp-ledger-row dead">bug · summarize<span className="st">unreachable</span></div>
            <div className="lp-ledger-sum"><span>$0.08 spent</span><span>0 usable results · no refund</span></div>
          </div>
        </div>
      </section>

      {/* PROTOCOL — scroll-driven */}
      <section className="lp-section tight" id="protocol">
        <div className="lp-container">
          <div className="reveal" style={{ maxWidth: 640 }}>
            <div className="lp-eyebrow">The protocol</div>
            <h2 className="lp-h2">Two phases. Nothing is paid during discovery.</h2>
            <p className="lp-lead">
              Discovery, policy, composition and simulation all happen before a signature exists. Every
              failure in the first four phases costs the agent exactly zero.
            </p>
          </div>

          <div className="lp-proto-grid">
            <div className="lp-proto-steps">
              {PHASES.map((p, i) => (
                <div
                  key={p.t}
                  ref={(el) => { stepRefs.current[i] = el; }}
                  className={`lp-proto-step ${step === i ? "active" : ""}`}
                >
                  <div className="idx">PHASE {String(i + 1).padStart(2, "0")}</div>
                  <h3>{p.t}</h3>
                  <p>{p.d}</p>
                  <div className={`cost ${p.free ? "free" : ""}`}>{p.cost}</div>
                </div>
              ))}
            </div>
            <div className="lp-stage-wrap">
              <ProtocolStage step={step} />
            </div>
          </div>
        </div>
      </section>

      {/* PLATFORM */}
      <section className="lp-section" id="platform">
        <div className="lp-container">
          <div className="reveal" style={{ maxWidth: 680 }}>
            <div className="lp-eyebrow">The platform</div>
            <h2 className="lp-h2">What AXIS adds on top of x402.</h2>
            <p className="lp-lead">
              Nine paid endpoints across five payout addresses, composed into nine workflows. Pick one and
              watch the atomic group build itself — then fail a provider and watch the money come back.
            </p>
          </div>
          <div className="reveal d1"><Composer /></div>
          <div className="lp-bento">
            {ADDS.map((c, i) => (
              <div className={`lp-card ${c.s} reveal d${(i % 3) + 1}`} key={c.t}>
                <span className="gl">{c.g}</span>
                <h3>{c.t}</h3>
                <p>{c.d}</p>
                <span className="tag">{c.tag}</span>
              </div>
            ))}
            <div className="lp-card wide s6 reveal d1">
              <div className="copy">
                <span className="gl">{GLYPH.key}</span>
                <h3>Clients never hold keys</h3>
                <p>
                  The SDK, the MCP server, the CLI agent and this console all speak plain HTTP to the
                  router. Signing lives in exactly one auditable place, so a leaked client credential
                  cannot move funds — it can only ask for a quote.
                </p>
                <span className="tag">one signer</span>
              </div>
              <div className="lp-receipt" aria-hidden="true">
                <div className="lp-receipt-head">
                  <span>axis-pay</span>
                  <span className="status" style={{ borderColor: "rgba(255,255,255,0.24)", background: "rgba(255,255,255,0.06)" }}>NO KEY</span>
                </div>
                <div className="lp-receipt-row" style={{ gridTemplateColumns: "1fr auto" }}><span>console</span><span className="ok">HTTP only</span></div>
                <div className="lp-receipt-row" style={{ gridTemplateColumns: "1fr auto" }}><span>mcp server</span><span className="ok">HTTP only</span></div>
                <div className="lp-receipt-row" style={{ gridTemplateColumns: "1fr auto" }}><span>cli agent</span><span className="ok">HTTP only</span></div>
                <div className="lp-receipt-row" style={{ gridTemplateColumns: "1fr auto" }}><span>router</span><span className="rv">signs</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* INTEGRATE */}
      <section className="lp-section tight" id="integrate">
        <div className="lp-container lp-split" style={{ alignItems: "start" }}>
          <div className="reveal" style={{ position: "sticky", top: 108 }}>
            <div className="lp-eyebrow">Integrate</div>
            <h2 className="lp-h2">Two calls. Quote, then pay.</h2>
            <p className="lp-lead">
              The whole protocol reduces to a quote you can inspect and a payment you can authorize.
              Everything underneath — the DAG, the policy guard, the group, the simulation, the
              compensation — is the router's problem, not yours.
            </p>
            <div className="lp-cta" style={{ justifyContent: "flex-start", marginTop: 28 }}>
              <Link href="/signup" className="lp-btn lp-btn-primary">Get an API key</Link>
              <Link href="/protocol" className="lp-btn lp-btn-ghost">Protocol reference</Link>
            </div>
          </div>
          <div className="reveal d1">
            <CodeTabs />
          </div>
        </div>
      </section>

      <div className="lp-container"><hr className="lp-rule" /></div>

      {/* SECURITY */}
      <section className="lp-section" id="security">
        <div className="lp-container">
          <div className="reveal" style={{ maxWidth: 660 }}>
            <div className="lp-eyebrow">Security</div>
            <h2 className="lp-h2">Five published attacks on x402. All five closed.</h2>
            <p className="lp-lead">
              Every provider runs the same hardened pipeline, in a fixed order: bind the proof to the
              resource, check its freshness, claim it exactly once — and only then verify payment and
              call the model. The console ships a red-team page that fires all five at production.
            </p>
          </div>
          <div className="lp-attacks">
            {ATTACKS.map((a, i) => (
              <div className={`lp-attack reveal d${(i % 3) + 1}`} key={a.n}>
                <span className="no">{a.n}</span>
                <span className="nm">{a.nm}</span>
                <span className="df">{a.d}</span>
                <span className="st">{a.st}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* RECEIPT */}
      <section className="lp-section tight" id="receipts">
        <div className="lp-container lp-split">
          <div className="reveal">
            <div className="lp-eyebrow">Receipts</div>
            <h2 className="lp-h2">One artifact that still resolves in a year.</h2>
            <p className="lp-lead">
              A receipt is not a log line. It maps the group id to every transaction, every provider
              result, the total and the final status — including the compensating transfer, recorded
              beside the payment it reverses rather than buried in a separate refunds table.
            </p>
          </div>
          <div className="lp-receipt reveal d1">
            <div className="lp-receipt-head">
              <span>group</span>
              <span style={{ color: "var(--fg)" }}>7QP4…K2M9</span>
              <span className="status">PARTIAL</span>
            </div>
            <div className="lp-receipt-row hd">
              <span>provider</span><span>usdc</span><span>txid</span><span>state</span>
            </div>
            {RECEIPT_LEGS.map((l) => (
              <div className="lp-receipt-row" key={l.p}>
                <span>{l.p}</span>
                <span>{l.a}</span>
                <span className="tx">{l.tx}</span>
                <span className={l.ok ? "ok" : "rv"}>{l.s}</span>
              </div>
            ))}
            <div className="lp-receipt-row">
              <span style={{ color: "var(--muted)" }}>↩ compensation</span>
              <span style={{ color: "var(--muted)" }}>0.05</span>
              <span className="tx">W8N1…5HJ</span>
              <span className="rv">confirmed</span>
            </div>
            <div className="lp-receipt-foot">
              <span>settled 0.13</span>
              <span>refunded 0.05</span>
              <span>net 0.08</span>
              <span className="net">3 of 4 delivered</span>
            </div>
          </div>
        </div>
      </section>

      {/* WHY ALGORAND */}
      <section className="lp-section tight" id="algorand">
        <div className="lp-container">
          <div className="reveal" style={{ maxWidth: 640 }}>
            <div className="lp-eyebrow">Why Algorand</div>
            <h2 className="lp-h2">Atomicity is a property of the chain, not of our code.</h2>
            <p className="lp-lead">
              On most chains, “atomic across N providers” means writing and auditing an escrow contract.
              Algorand gives it natively — so AXIS composes the payments and lets the chain guarantee them.
            </p>
          </div>
          <div className="lp-stats">
            {WHY.map((w, i) => (
              <div className={`lp-stat reveal d${(i % 3) + 1}`} key={w.v}>
                <div className="v">{w.v}</div>
                <div className="k">{w.k}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="lp-section tight" id="pricing">
        <div className="lp-container">
          <div className="lp-price reveal">
            <div>
              <div className="lp-eyebrow">Pricing</div>
              <h2 className="lp-h2">Built for machines, not for seats.</h2>
              <p className="lp-lead">
                The paying customer is the CI pipeline, and it pays per workflow run. No subscription, no
                seat count, no API keys to provision. A busy month costs more; a quiet month costs nothing.
              </p>
            </div>
            <div className="lp-price-figs">
              <div><div className="v accent">$0.14</div><div className="k">per PR review</div></div>
              <div><div className="v">$26</div><div className="k">200 runs / month</div></div>
              <div><div className="v">$0</div><div className="k">a quiet month</div></div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="lp-section tight" id="faq">
        <div className="lp-container">
          <div className="reveal" style={{ maxWidth: 620 }}>
            <div className="lp-eyebrow">Questions</div>
            <h2 className="lp-h2">The things people ask second.</h2>
          </div>
          <div className="lp-faq reveal d1">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p className="ans">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="lp-section tight">
        <div className="lp-container">
          <div className="lp-band reveal">
            <h2 className="lp-h2">Ship agent payments that compose.</h2>
            <p className="lp-lead">
              One signature, one atomic group, one receipt — and your money back when a provider fails to deliver.
            </p>
            <div className="lp-cta">
              <Link href="/signup" className="lp-btn lp-btn-primary lp-btn-lg">Start building</Link>
              <Link href="/projects" className="lp-btn lp-btn-ghost lp-btn-lg">Open the console</Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-container">
          <div className="lp-foot-grid">
            <div className="lp-foot-brand">
              <Link href="/" className="lp-brand"><Logo id="foot" />AXIS</Link>
              <p>Atomic X402 Integrated Settlement — the layer that turns N paid API calls into one all-or-nothing payment on Algorand.</p>
            </div>
            <div className="lp-foot-cols">
              <div className="lp-foot-col">
                <h5>Product</h5>
                <a href="#platform">Platform</a>
                <a href="#pricing">Pricing</a>
                <Link href="/projects">Console</Link>
                <Link href="/agent">Autonomous agent</Link>
              </div>
              <div className="lp-foot-col">
                <h5>Protocol</h5>
                <Link href="/protocol">The eight steps</Link>
                <a href="#algorand">Why Algorand</a>
                <Link href="/attack">Security</Link>
                <Link href="/refunds">Refunds</Link>
              </div>
              <div className="lp-foot-col">
                <h5>Account</h5>
                <Link href="/login">Sign in</Link>
                <Link href="/signup">Sign up</Link>
                <Link href="/receipts">Receipts</Link>
              </div>
            </div>
          </div>
          <div className="lp-foot-bottom">
            <span>© 2026 AXIS</span>
            <span>HackNite Code Royale · x402 &amp; Algorand</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
