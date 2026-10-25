/**
 * AXIS Live Monitor — an animated flowchart of the real stack.
 *
 * Follows the router's live event stream and turns each step into motion. The
 * left column is the fixed cast (agent, guard, router, Neon, group, fee payer,
 * receipt); the right panel lists EVERY service the router reports, one row
 * each, so the count is whatever the API says rather than a number baked in
 * here. Wires carry a travelling dot while work is in flight, and coins run the
 * edges when money moves — forward on settle, back to the agent on a refund.
 */

const DEFAULT_ROUTER = "http://localhost:8080";
const SVGNS = "http://www.w3.org/2000/svg";
const $ = (id) => document.getElementById(id);
const scene = $("scene");

let router = DEFAULT_ROUTER;
let apiKey = "";
let followedRunId = null, es = null, view = null;
let slotOf = {};
let catalogue = [], boxOfProvider = {};   // ALL services (from /v1/workflows) + name→box

// ── Scene geometry ──────────────────────────────────────────────────────────
// The flowchart, top to bottom: agent → router (flanked by guard + Neon) →
// atomic group (with the fee payer beside it) → every service → one receipt.
// Sizes are deliberately generous: at panel width a 5-wide row of services is
// unreadable, so services wrap 3 per row and keep full-size labels.
const VB_W = 380;
const SERV_COLS = 3, SERV_W = 112, SERV_H = 32, SERV_GAP_X = 7, SERV_GAP_Y = 7;
const SERV_TOP = 196;

/** The fixed cast. Services are added per catalogue, in their own id space. */
const FIXED = ["agent", "guard", "router", "neon", "group", "facil", "receipt"];
const N = {
  agent:   { cx: 190, cy: 24,  w: 216, h: 32, name: "Agent",        role: "your USDC wallet" },
  guard:   { cx: 56,  cy: 86,  w: 100, h: 32, name: "Guard",        role: "spend policy" },
  router:  { cx: 190, cy: 86,  w: 140, h: 32, name: "AXIS router",  role: "discover & quote" },
  neon:    { cx: 324, cy: 86,  w: 104, h: 32, name: "Neon",         role: "quote + txids" },
  group:   { cx: 136, cy: 148, w: 184, h: 32, name: "Atomic group", role: "all-or-nothing" },
  facil:   { cx: 300, cy: 148, w: 124, h: 32, name: "GoPlausible",  role: "pays ALGO fees" },
  receipt: { cx: 190, cy: 340, w: 228, h: 32, name: "Receipt",      role: "one per run" },
};

// Service boxes are laid out DYNAMICALLY per catalogue — 9 today, whatever the
// router reports tomorrow. Nothing here assumes a count.
let PROV = [];
const EDGES = [
  ["agent", "router"], ["router", "guard"], ["router", "neon"],
  ["router", "group"], ["facil", "group"], ["group", "neon"],
];
const ctr = (id) => ({ x: N[id].cx, y: N[id].cy });
function anchor(a, b) {
  const A = N[a], B = N[b], dx = B.cx - A.cx, dy = B.cy - A.cy;
  if (Math.abs(dx) > Math.abs(dy)) return { x: A.cx + Math.sign(dx) * A.w / 2, y: A.cy };
  return { x: A.cx, y: A.cy + Math.sign(dy) * A.h / 2 };
}

/**
 * A wire between two anchors: a cubic bezier that leaves and enters along the
 * dominant axis, so a fan-out of edges from one node reads as separate curves
 * rather than a bundle of crossing straight lines.
 */
function wire(p1, p2) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const k = 0.5;
  return Math.abs(dx) > Math.abs(dy)
    ? `M${p1.x},${p1.y} C${p1.x + dx * k},${p1.y} ${p2.x - dx * k},${p2.y} ${p2.x},${p2.y}`
    : `M${p1.x},${p1.y} C${p1.x},${p1.y + dy * k} ${p2.x},${p2.y - dy * k} ${p2.x},${p2.y}`;
}

const TERMINAL = ["SETTLED", "PARTIAL", "FAILED", "REVERSED", "RECOVERY_REQUIRED"];

/** A dot that travels the wire itself — the signal that something is moving. */
function wireDot(f, t, dur = 1.1) {
  const id = `e-${f}-${t}`;
  if (!$(id) || $(`d-${id}`)) return;          // no such edge, or one already running
  if (view && TERMINAL.includes(view.status)) return;   // run is over — nothing is in flight
  const g = document.createElementNS(SVGNS, "circle");
  g.setAttribute("id", `d-${id}`);
  g.setAttribute("r", "2.6");
  g.setAttribute("class", "wire-dot");
  const mo = document.createElementNS(SVGNS, "animateMotion");
  mo.setAttribute("dur", `${dur}s`);
  mo.setAttribute("repeatCount", "indefinite");
  const mp = document.createElementNS(SVGNS, "mpath");
  mp.setAttribute("href", `#${id}`);
  mo.appendChild(mp);
  g.appendChild(mo);
  scene.appendChild(g);
}
const clearWireDots = () => scene.querySelectorAll(".wire-dot").forEach((e) => e.remove());

// ── Build the whole scene ───────────────────────────────────────────────────
/**
 * Geometry depends on how many services the router actually reports, so the
 * scene is rebuilt as one unit rather than patched in pieces. Provider rows
 * live in their own id space (p0…pN) and are deliberately NOT mixed into the
 * fixed-node loop — doing that once drew every service twice, as a big card
 * and a row on top of each other.
 */
function buildScene() {
  const count = catalogue.length;
  PROV = catalogue.map((_, i) => `p${i}`);
  boxOfProvider = {};

  // Lay the services out first — their grid height decides where the receipt
  // sits and how tall the scene is.
  const rows = Math.max(1, Math.ceil(count / SERV_COLS));
  catalogue.forEach((prov, i) => {
    const r = Math.floor(i / SERV_COLS), c = i % SERV_COLS;
    const inRow = Math.min(SERV_COLS, count - r * SERV_COLS);
    const rowW = inRow * SERV_W + (inRow - 1) * SERV_GAP_X;
    N[`p${i}`] = {
      cx: (VB_W - rowW) / 2 + SERV_W / 2 + c * (SERV_W + SERV_GAP_X),
      cy: SERV_TOP + r * (SERV_H + SERV_GAP_Y) + SERV_H / 2,
      w: SERV_W, h: SERV_H, name: prov, role: "",
    };
    boxOfProvider[prov] = i;
  });
  const gridBottom = SERV_TOP + rows * (SERV_H + SERV_GAP_Y);
  N.receipt.cy = gridBottom + 30;
  const H = N.receipt.cy + N.receipt.h / 2 + 10;
  scene.setAttribute("viewBox", `0 0 ${VB_W} ${H}`);

  let s = `
    <defs>
      <radialGradient id="gold" cx="35%" cy="30%" r="75%">
        <stop offset="0%" stop-color="#fff6d8"/><stop offset="35%" stop-color="#e8c07a"/>
        <stop offset="100%" stop-color="#8a6a2e"/>
      </radialGradient>
      <filter id="cglow" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="2" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>`;

  // The lane the services sit in, drawn behind them.
  if (count) {
    const top = SERV_TOP - 20;
    s += `<rect class="panel-box" x="6" y="${top}" width="${VB_W - 12}" height="${gridBottom - top}" rx="10"/>
          <text class="panel-lbl" id="panel-lbl" x="16" y="${top + 13}">SERVICES · UNPAID</text>`;
  }

  // Wires under everything.
  for (const [f, t] of EDGES) {
    s += `<path id="e-${f}-${t}" class="edge" d="${wire(anchor(f, t), anchor(t, f))}"/>`;
  }
  catalogue.forEach((_, i) => {
    for (const [f, t] of [["group", `p${i}`], [`p${i}`, "receipt"]]) {
      s += `<path id="e-${f}-${t}" class="edge" d="${wire(anchor(f, t), anchor(t, f))}"/>`;
    }
  });

  for (const id of FIXED) s += nodeSvg(id, N[id]);
  catalogue.forEach((_, i) => { s += provSvg(`p${i}`, N[`p${i}`]); });
  scene.innerHTML = s;

  catalogue.forEach((_, i) => markUnused(`p${i}`));   // nothing is used until a run says so
}

/** A fixed actor: name over a mono sub-line. No logo — the shape carries it. */
function nodeSvg(id, n) {
  const x = n.cx - n.w / 2, y = n.cy - n.h / 2;
  return `<g id="n-${id}">
    <rect class="card" id="card-${id}" x="${x}" y="${y}" width="${n.w}" height="${n.h}" rx="10"/>
    <text class="name" id="name-${id}" x="${x + 10}" y="${n.cy - 1}">${n.name}</text>
    <text class="role" id="role-${id}" x="${x + 10}" y="${n.cy + 10}">${n.role}</text>
  </g>`;
}

/** A service box: name, status under it, and a state tag in the corner. */
function provSvg(id, n) {
  const x = n.cx - n.w / 2, y = n.cy - n.h / 2;
  return `<g id="n-${id}">
    <rect class="card" id="card-${id}" x="${x}" y="${y}" width="${n.w}" height="${n.h}" rx="8"/>
    <text class="name prov" id="name-${id}" x="${n.cx}" y="${n.cy - 2}" text-anchor="middle">${shortName(n.name)}</text>
    <text class="role" id="role-${id}" x="${n.cx}" y="${n.cy + 8}" text-anchor="middle">${n.role || ""}</text>
    <text class="tag" id="tag-${id}" x="${n.cx - n.w / 2 + 7}" y="${n.cy - 2}" text-anchor="start"></text>
  </g>`;
}

/** Provider names are long; drop the redundant suffix so the box stays legible. */
const shortName = (p) => String(p || "").replace(/-(explainer|checker|roaster|summarizer|generator|writer)$/, "");

const setPanelLabel = (s) => { const e = $("panel-lbl"); if (e) e.textContent = s; };
const setTag = (id, s, mod) => {
  const e = $(`tag-${id}`);
  if (e) { e.textContent = s || ""; e.setAttribute("class", "tag" + (mod ? " " + mod : "")); }
};
function markUnused(id) { setCard(id, "unused"); setRole(id, "not called"); setTag(id, "—"); }
function markUsed(id) { setCard(id, "active"); setRole(id, "selected"); setTag(id, ""); }

/** Fetch the full service catalogue (distinct providers across all workflows). */
async function fetchCatalogue() {
  try {
    const res = await fetch(`${router}/v1/workflows`, { cache: "no-store" });
    if (!res.ok) return;
    const { workflows } = await res.json();
    const set = [];
    for (const wf of (workflows || [])) for (const st of (wf.steps || [])) if (!set.includes(st.provider)) set.push(st.provider);
    if (set.length) { catalogue = set; if (view) buildScene(); }
  } catch { /* offline — fall back to the run's own providers */ }
}

// ── Scene mutators ──────────────────────────────────────────────────────────
const setCard = (id, cls) => { const e = $(`card-${id}`); if (e) e.setAttribute("class", "card " + (cls || "")); };
const setName = (id, s) => { const e = $(`name-${id}`); if (e) e.textContent = s; };
const setRole = (id, s, mod) => { const e = $(`role-${id}`); if (e) { e.textContent = s; e.setAttribute("class", "role" + (mod ? " " + mod : "")); } };
const pulse = (f, t, cls) => {
  const e = $(`e-${f}-${t}`);
  if (!e) return;
  e.setAttribute("class", "edge " + (cls || "active"));
  wireDot(f, t, cls === "refund" ? 1.4 : 1.1);
};

/** A stream of travelling markers: golden coins for MONEY, cyan chips for RESULTS. */
function coins(fromId, toId, { n = 3, dur = 0.9, gap = 0.16, refund = false, record = false } = {}) {
  const a = ctr(fromId), b = ctr(toId);
  for (let i = 0; i < n; i++) {
    const begin = i * gap;
    const g = document.createElementNS(SVGNS, "g");
    g.setAttribute("filter", "url(#cglow)");
    g.setAttribute("opacity", "0");
    g.innerHTML = record
      ? `<rect x="-4.5" y="-4.5" width="9" height="9" rx="2" fill="#63b3ff" stroke="#0e2a33" stroke-width="1"/>`
      : `<circle r="6" fill="url(#gold)" stroke="${refund ? "#b45309" : "#8a5e12"}" stroke-width="1"/>
         <circle r="2" cx="-1.6" cy="-1.8" fill="#fffbe9" opacity=".85"/>`;
    const mo = document.createElementNS(SVGNS, "animateMotion");
    mo.setAttribute("dur", `${dur}s`); mo.setAttribute("begin", `${begin}s`);
    mo.setAttribute("fill", "freeze"); mo.setAttribute("path", `M${a.x},${a.y} L${b.x},${b.y}`);
    const op = document.createElementNS(SVGNS, "animate");
    op.setAttribute("attributeName", "opacity"); op.setAttribute("values", "0;1;1;0");
    op.setAttribute("dur", `${dur}s`); op.setAttribute("begin", `${begin}s`); op.setAttribute("fill", "freeze");
    g.appendChild(mo); g.appendChild(op);
    scene.appendChild(g);
    setTimeout(() => g.remove(), (begin + dur) * 1000 + 250);
  }
}

const caption = (html) => { $("caption").innerHTML = html; };
const short = (p) => String(p || "").replace(/-(explainer|checker|roaster|summarizer)$/, "");

// ── Live backend terminal — tail every event as a formatted log line ─────────
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const clip = (s, n) => String(s || "").slice(0, n);

/** Return { cls, msg } for one event — cls colours the event token. */
function fmt(e) {
  switch (e.type) {
    case "run.started": return { cls: "", msg: `<span class="dim">${clip(e.runId, 20)} · ${esc(e.workflow || "")} · ${(e.nodes || []).length} providers</span>` };
    case "probe.sent": return { cls: "", msg: `→ ${esc(short(e.provider) || e.stepId)} <span class="dim">(unpaid 402 probe)</span>` };
    case "challenge.received": return { cls: "", msg: `← ${esc(short(e.provider) || e.stepId)}  <span class="money">$${esc(e.priceUSDC)}</span> <span class="dim">payTo ${clip(e.payTo, 6)}…</span>` };
    case "quote.ready": return { cls: "", msg: `total <span class="money">$${esc(e.totalUSDC)}</span> → <span class="g">Neon</span> <span class="dim">[OPEN, single-use]</span>` };
    case "policy.evaluated": return e.verdict === "PASS" ? { cls: "ok", msg: `<span class="g">PASS</span> <span class="dim">under every ceiling</span>` } : { cls: "err", msg: `<span class="r">FAIL — nothing will be signed</span>` };
    case "group.composed": return { cls: "", msg: `${e.groupSize} legs · <span class="dim">Algorand atomic group</span>` };
    case "group.simulated": return e.passed ? { cls: "ok", msg: `<span class="g">OK</span> <span class="dim">dry run ${e.durationMs || 0}ms — safe to submit</span>` } : { cls: "err", msg: `<span class="r">SIMULATION FAILED — not submitted</span>` };
    case "settle.retry": return { cls: "warn", msg: `<span class="y">retry ${e.attempt}/${e.maxAttempts - 1}</span> <span class="dim">${esc(clip(e.message, 44))}</span>` };
    case "group.signed": return { cls: "", msg: `<span class="g">1 signature</span> · ${e.legCount} payments <span class="dim">· GoPlausible pays fees</span>` };
    case "group.settled": return { cls: "ok", msg: `<span class="g">round ${e.confirmedRound}</span> · ${(e.txids || []).length} txids · <span class="dim">group ${clip(e.groupId, 10)}…</span>` };
    case "step.started": return { cls: "", msg: `${esc(e.stepId)} <span class="dim">running…</span>` };
    case "step.delivered": return { cls: "ok", msg: `${esc(e.stepId)} <span class="g">✓</span> <span class="dim">${e.latencyMs}ms</span>` };
    case "step.failed": return { cls: "err", msg: `${esc(e.stepId)} <span class="r">FAILED</span> <span class="dim">${esc(clip(e.message, 40))}</span>` };
    case "step.skipped": return { cls: "warn", msg: `${esc(e.stepId)} <span class="y">skipped</span> <span class="dim">(dep failed)</span>` };
    case "node.state": return { cls: "", msg: `<span class="dim">${esc(e.stepId)} → ${esc(e.state)}</span>` };
    case "compensation.issued": return { cls: "warn", msg: `${esc(short(e.provider))} <span class="y">REVERSED</span> <span class="money">$${esc(e.amountUSDC || "")}</span> <span class="dim">refund ${clip(e.txid, 10)}…</span>` };
    case "run.completed": return e.status === "SETTLED"
      ? { cls: "ok", msg: `<span class="g">SETTLED</span> · total <span class="money">$${esc(e.totalUSDC)}</span>` }
      : { cls: "warn", msg: `<span class="y">${esc(e.status)}</span> · refunded <span class="money">$${esc(e.refundedUSDC)}</span> on-chain` };
    case "run.error": return { cls: "err", msg: `<span class="r">${esc(e.code)}</span> <span class="dim">${esc(clip(e.message, 44))}</span>` };
    default: return { cls: "", msg: `<span class="dim">${esc(clip(JSON.stringify(e), 60))}</span>` };
  }
}

function term(e) {
  const body = $("term-body");
  if (!body) return;
  const empty = body.querySelector(".empty");
  if (empty) body.innerHTML = "";
  const t = e.at ? new Date(e.at) : new Date();
  const ts = t.toTimeString().slice(0, 8) + "." + String(t.getMilliseconds()).padStart(3, "0");
  const { cls, msg } = fmt(e);
  const ln = document.createElement("div");
  ln.className = "ln";
  ln.innerHTML = `<span class="ts">${ts}</span> <span class="ev ${cls}">${esc(pad(e.type, 20))}</span> ${msg}`;
  body.appendChild(ln);
  while (body.childNodes.length > 240) body.removeChild(body.firstChild);
  body.scrollTop = body.scrollHeight;
}
function clearTerm() { const b = $("term-body"); if (b) b.innerHTML = `<div class="empty">…</div>`; }

// ── View + event fold ───────────────────────────────────────────────────────
function fresh() { buildScene(); clearTerm(); slotOf = {}; return { runId: null, status: "idle", paidSlots: [], used: [] }; }

function apply(e) {
  switch (e.type) {
    case "run.started": {
      view.status = "running";
      setCard("agent", "active"); setCard("router", "active"); pulse("agent", "router");
      const used = e.nodes || [];
      // If we don't have the full catalogue yet, fall back to this run's providers.
      if (!catalogue.length) { catalogue = used.map((n) => n.provider); buildScene(); }
      slotOf = {}; view.used = [];
      PROV.forEach((_, i) => markUnused(`p${i}`));         // cross out everything first
      used.forEach((nd) => {
        const bi = boxOfProvider[nd.provider];
        if (bi != null) { slotOf[nd.stepId] = bi; view.used.push(bi); markUsed(`p${bi}`); }
      });
      setPanelLabel(`SERVICES · ${view.used.length} OF ${PROV.length} SELECTED`);
      caption(`Agent runs <b>${esc(e.workflow || "the workflow")}</b> — <b>${view.used.length}</b> of ${PROV.length} services selected. The rest are never called and never paid.`);
      break;
    }
    case "probe.sent": {
      const s = slotOf[e.stepId];
      if (s != null) { setCard(PROV[s], "active"); setTag(PROV[s], "402"); pulse("router", PROV[s]); }
      caption(`Router sends <b>unpaid 402 probes</b> to every selected service. Still $0.00.`);
      break;
    }
    case "challenge.received": {
      const s = slotOf[e.stepId];
      if (s != null) { setCard(PROV[s], "active"); setRole(PROV[s], `${e.priceUSDC} USDC`, "price"); setTag(PROV[s], "402"); }
      caption(`Each service answers with its <b>402 price</b>. AXIS reads prices from the protocol — never hardcoded.`);
      break;
    }
    case "quote.ready":
      setCard("neon", "active"); pulse("router", "neon"); setRole("neon", "quote saved");
      coins("router", "neon", { n: 1, dur: 0.6 });
      caption(`Signed <b>quote = $${e.totalUSDC}</b>, stored in <b>Neon</b> as OPEN (single-use).`);
      break;
    case "policy.evaluated":
      setCard("guard", e.verdict === "PASS" ? "pass" : "fail"); pulse("router", "guard");
      setRole("guard", e.verdict === "PASS" ? "PASS ✓" : "BLOCKED", e.verdict === "PASS" ? "" : "warn");
      caption(e.verdict === "PASS"
        ? `<b>Spend Guard</b> passes — under every ceiling. A fail here means <b>nothing is ever signed</b>.`
        : `<span class="warn"><b>Spend Guard BLOCKED</b> this workflow — no group, no payment.</span>`);
      break;
    case "group.composed":
      setCard("group", "active"); pulse("router", "group"); setRole("group", `${e.groupSize} legs`);
      setPanelLabel(`ATOMIC GROUP · ${e.groupSize} LEGS`);
      caption(`<b>One atomic group</b> — ${e.groupSize} USDC payments to ${e.groupSize} different payees, one signature.`);
      break;
    case "group.simulated":
      setCard("group", e.passed ? "active" : "failed");
      caption(e.passed
        ? `<b>Simulated</b> on-chain first (free dry run). Passed → safe to submit.`
        : `<span class="warn">Simulation failed — <b>nothing submitted</b>, agent pays $0.</span>`);
      break;
    case "settle.retry":
      setCard("group", "failed");
      setRole("group", `retry ${e.attempt}/${e.maxAttempts - 1}`, "warn");
      caption(`<span class="warn">Settlement failed — <b>auto-retrying</b> (attempt ${e.attempt} of ${e.maxAttempts - 1}). After ${e.maxAttempts - 1} it stops. No double-pay — same signed group.</span>`);
      break;
    case "group.signed":
      setCard("facil", "active"); pulse("facil", "group"); setRole("facil", "pays ALGO fees");
      caption(`<b>One signature</b> authorizes all ${e.legCount} payments. <b style="color:#a78bfa">GoPlausible</b> covers the ALGO fees — agent needs only USDC.`);
      break;
    case "group.settled": {
      setCard("group", "paid"); setRole("group", `round ${e.confirmedRound}`);
      pulse("group", "neon", "paid"); setRole("neon", "txids saved");
      // The money moment: agent → group, then group → every provider.
      coins("agent", "group", { n: 4, dur: 0.7, gap: 0.1 });
      (e.txids || []).forEach((t) => {
        const s = slotOf[t.stepId];
        if (s != null) { view.paidSlots.push(s); pulse("group", PROV[s], "paid"); setCard(PROV[s], "paid"); coins("group", PROV[s], { n: 3, dur: 0.85 }); }
      });
      caption(`<span class="paid"><b>SETTLED</b> — golden coins land at all ${(e.txids || []).length} providers in one atomic group. Txids saved to <b style="color:#00e599">Neon</b>.</span>`);
      break;
    }
    case "step.started": { const s = slotOf[e.stepId]; if (s != null) setCard(PROV[s], "running"); break; }
    case "step.delivered": {
      const s = slotOf[e.stepId];
      if (s != null) { setCard(PROV[s], "delivered"); setRole(PROV[s], `✓ delivered ${e.latencyMs}ms`); coins(PROV[s], "receipt", { n: 1, dur: 0.7, record: true }); pulse(PROV[s], "receipt", "paid"); }
      caption(`Provider returns its <span class="paid">resource delivered</span> — the work the agent paid for, recorded into the receipt.`);
      break;
    }
    case "step.failed":
    case "step.skipped": { const s = slotOf[e.stepId]; if (s != null) setCard(PROV[s], "failed"); break; }
    case "node.state": { const s = slotOf[e.stepId]; if (s != null && e.state) setCard(PROV[s], mapState(e.state)); break; }
    case "compensation.issued": {
      const s = slotOf[e.stepId];
      if (s != null) {
        setCard(PROV[s], "refunded"); setRole(PROV[s], "✗ refunded", "warn");
        pulse("group", PROV[s], "refund"); coins(PROV[s], "agent", { n: 3, dur: 1.1, refund: true });
        // The failed leg is NOT left hanging — its refund is recorded into the receipt too.
        pulse(PROV[s], "receipt", "refund"); coins(PROV[s], "receipt", { n: 1, dur: 0.9, record: true });
      }
      caption(`<span class="warn"><b>${short(e.provider)}</b> took payment but failed — leg <b>reversed on-chain</b>, then recorded in the receipt. Nothing left unresolved.</span>`);
      break;
    }
    case "run.completed": {
      view.status = e.status;
      // The run is over — nothing is in flight, so no wire should still crawl.
      clearWireDots();
      setCard("agent", e.status === "SETTLED" ? "paid" : "refunded");
      if (e.status === "REVERSED" || e.status === "FAILED") {
        // Everything unwinds: ALL coins return to where they started.
        view.paidSlots.forEach((s) => { setCard(PROV[s], "refunded"); pulse("group", PROV[s], "refund"); coins(PROV[s], "agent", { n: 3, dur: 1.1, refund: true }); });
      }
      // The flow ALWAYS ends here: every USED provider's outcome converges into
      // ONE unified receipt. Unused services (✕) are never paid, never recorded.
      (view.used || []).forEach((bi) => { pulse(`p${bi}`, "receipt", e.status === "SETTLED" ? "paid" : "refund"); coins(`p${bi}`, "receipt", { n: 1, dur: 0.7, gap: 0.08, record: true }); });
      const rcls = e.status === "SETTLED" ? "paid" : (e.status === "PARTIAL" ? "refunded" : "failed");
      setCard("receipt", rcls);
      setRole("receipt",
        e.status === "SETTLED" ? `✓ created · $${e.totalUSDC}` : `${e.status} · $${e.refundedUSDC} back`,
        e.status === "SETTLED" ? "" : "warn");
      caption(e.status === "SETTLED"
        ? `<span class="paid"><b>Receipt created</b> — ${(view.used || []).length} of ${PROV.length} services used & paid ($${e.totalUSDC}), the rest ✕ never charged. One signature.</span>`
        : `<span class="warn"><b>Receipt created</b> — delivered + <b>refunded</b> legs both recorded, $${e.refundedUSDC} back on-chain. ${e.status}, nothing left unresolved.</span>`);
      break;
    }
    case "run.error":
      view.status = e.code === "PAYMENT_RECOVERY_REQUIRED" ? "RECOVERY_REQUIRED" : "FAILED";
      caption(`<span class="warn">${e.costedNothing ? "Rejected" : "Needs attention"}: ${esc(e.message || e.code)}${e.costedNothing ? " — you paid nothing." : ""}</span>`);
      break;
  }
}
const mapState = (s) => ({ running: "running", delivered: "delivered", refunded: "refunded", compensating: "failed", failed: "failed", paid: "paid" }[s] || "active");

// ── Connect + follow the latest live run ────────────────────────────────────
const setConn = (s) => { const el = $("conn"); el.textContent = s; el.className = "status " + s; };
// The panel always opens clean: whatever run was last on the router is treated
// as already-seen, so we never replay a stale run. Only a run that STARTS after
// the panel opened is followed.
let baselined = false;
async function pollLatest() {
  // The API key IS the connection. Without one there is no account to follow,
  // and falling back to the router's global latest run would show whatever
  // somebody else happened to be running.
  if (!apiKey) { setConn("no key"); return; }
  try {
    const res = await fetch(`${router}/v1/runs/latest?key=${encodeURIComponent(apiKey)}`, { cache: "no-store" });
    if (!res.ok) throw 0;
    const { runId, live } = await res.json();
    if (["offline", "no key"].includes($("conn").textContent)) setConn("online");
    if (!baselined) {
      baselined = true;
      // A run still in flight when the panel opens is joined, not skipped —
      // that is the case where you fired a task from Claude and then came
      // looking. Only an already-finished run is baselined away.
      if (runId && live) { follow(runId); return; }
      followedRunId = runId ?? null;
      if (runId) caption("Waiting for a <b>new run</b> — the previous one is not replayed.");
      return;
    }
    if (runId && runId !== followedRunId) follow(runId);
  } catch { setConn("offline"); }
}
function follow(runId) {
  const demoLabel = $("demo-label");
  if (demoLabel) demoLabel.style.display = runId.startsWith("demo_") ? "block" : "none";
  followedRunId = runId; if (es) es.close();
  QUEUE.length = 0; draining = false;      // drop any backlog from the last run
  view = fresh(); view.runId = runId; setConn("running");
  es = new EventSource(`${router}/v1/runs/${runId}/events?key=${encodeURIComponent(apiKey)}`);
  es.onmessage = onEvent;
  for (const t of ALL_EVENTS) es.addEventListener(t, onEvent);
  es.onerror = () => setConn("reconnecting");
}
/**
 * Events are queued and drained on a floor interval rather than applied the
 * instant they arrive.
 *
 * A run you were not watching replays its whole buffer in one burst the moment
 * you subscribe — ten events inside a millisecond — and the graph snaps
 * straight to "settled" having visibly done nothing. That is exactly the case
 * that matters here: the task is fired from Claude, Chrome throttles this
 * panel while it is in the background, and by the time you look the run is
 * over. Pacing the drain makes a replay animate like the live run did.
 *
 * A genuinely live run emits seconds apart, so the floor never delays it.
 */
const QUEUE = [];
let draining = false;
const DRAIN_MS = 220;

function drain() {
  const e = QUEUE.shift();
  if (!e) { draining = false; return; }
  term(e); apply(e);
  // Only pace while a backlog exists; the last event lands immediately.
  if (QUEUE.length) setTimeout(drain, DRAIN_MS);
  else draining = false;
}

function onEvent(ev) {
  let e;
  try { e = JSON.parse(ev.data); } catch { return; }
  QUEUE.push(e);
  if (!draining) { draining = true; drain(); }
}
const ALL_EVENTS = ["run.started","probe.sent","challenge.received","quote.ready","policy.evaluated","group.composed","group.simulated","settle.retry","group.signed","group.settled","step.started","step.delivered","step.failed","step.skipped","compensation.issued","node.state","run.completed","run.error"];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[x]));

// ── Connection state + boot ─────────────────────────────────────────────────
/** Connected = we hold an API key. Everything else is an advanced override. */
function paintConnState() {
  const connected = !!apiKey;
  $("gate").style.display = connected ? "none" : "block";
  $("stage").style.display = connected ? "block" : "none";
  if (!connected) setConn("no key");
}

chrome.storage?.local.get(["router", "apiKey"], (r) => {
  router = r.router || DEFAULT_ROUTER; $("router").value = router;
  apiKey = r.apiKey || ""; $("apikey").value = apiKey;
  paintConnState();
  if (apiKey) { fetchCatalogue(); pollLatest(); }
});

function connect() {
  router = ($("router").value || DEFAULT_ROUTER).replace(/\/$/, "");
  apiKey = ($("apikey").value || "").trim();
  chrome.storage?.local.set({ router, apiKey });
  // Re-baseline against the new key too — a saved change starts clean.
  followedRunId = null; baselined = false; catalogue = []; if (es) { es.close(); es = null; }
  view = fresh();
  paintConnState();
  if (!apiKey) return;
  setConn("online");
  caption("Waiting for a <b>new run</b> — the previous one is not replayed.");
  fetchCatalogue(); pollLatest();
}
$("save").addEventListener("click", connect);
$("apikey").addEventListener("keydown", (e) => { if (e.key === "Enter") connect(); });
$("disconnect").addEventListener("click", () => {
  apiKey = ""; $("apikey").value = "";
  chrome.storage?.local.set({ apiKey: "" });
  followedRunId = null; baselined = false; if (es) { es.close(); es = null; }
  view = fresh();
  paintConnState();
});

view = fresh();
setInterval(pollLatest, 2000);

// Chrome throttles background timers, so a run triggered from ANOTHER app
// (e.g. Claude Desktop via MCP) isn't noticed until the panel is looked at
// again. Poll immediately on refocus/visibility so it catches up at once.
document.addEventListener("visibilitychange", () => { if (!document.hidden) pollLatest(); });
window.addEventListener("focus", pollLatest);
