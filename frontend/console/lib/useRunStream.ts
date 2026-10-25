/**
 * useRunStream — subscribe to a run's live event stream and fold it through the
 * state machine. Phase F1.4.
 *
 * Reconnect-safe by construction: the router's SSE endpoint replays its buffer
 * to a late/reconnecting subscriber, and the state machine dedups by seq and
 * flags gaps. So a dropped connection recovers without duplicating events.
 *
 * Works against the live router OR the mock stream — see useMockRun below —
 * so the whole console is buildable before the backend exists.
 */
"use client";
import { useEffect, useRef, useState } from "react";
import type { RunEvent } from "@axis/shared";
import { mockRun, type MockScenario } from "@axis/shared";
import { applyEvent, initialRunView, type RunView } from "./state-machine.ts";
import { api } from "./api.ts";

export function useRunStream(runId: string | null): RunView {
  const [view, setView] = useState<RunView>(initialRunView);

  useEffect(() => {
    if (!runId) return;
    setView(initialRunView());
    const es = new EventSource(api.eventsUrl(runId));
    const onMsg = (ev: MessageEvent) => {
      try {
        const e = JSON.parse(ev.data) as RunEvent;
        setView((v) => applyEvent(v, e));
      } catch { /* heartbeat comment line, ignore */ }
    };
    // The router names each SSE event by its type; listen broadly.
    es.onmessage = onMsg;
    for (const t of [
      "run.started", "probe.sent", "challenge.received", "quote.ready",
      "policy.evaluated", "group.composed", "group.simulated", "settle.retry", "group.signed",
      "group.settled", "step.started", "step.delivered", "step.failed",
      "step.skipped", "compensation.issued", "node.state", "run.completed", "run.error",
    ]) es.addEventListener(t, onMsg as EventListener);
    es.onerror = () => { /* EventSource auto-reconnects; router replays buffer */ };
    return () => es.close();
  }, [runId]);

  return view;
}

/** Mock driver — same RunView, no backend. For building UI in parallel. */
export function useMockRun(scenario: MockScenario = "partial", trigger = 0): RunView {
  const [view, setView] = useState<RunView>(initialRunView);
  const active = useRef(0);

  useEffect(() => {
    if (trigger === 0) return;
    const run = ++active.current;
    setView(initialRunView());
    (async () => {
      for await (const e of mockRun({ scenario, speed: 2 })) {
        if (active.current !== run) return;
        setView((v) => applyEvent(v, e));
      }
    })();
  }, [scenario, trigger]);

  return view;
}
