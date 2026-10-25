"use client";
import { use } from "react";
import { useRunStream } from "../../../lib/useRunStream.ts";
import { ProtocolRail, WorkflowGraph, PolicyPanel, GroupPanel, Outcome, EventLog } from "../../../components/RunView.tsx";

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const view = useRunStream(id);
  return (
    <main className="mx-auto max-w-4xl space-y-5 p-8 font-mono">
      {id.startsWith("demo_") && <div role="status" className="card">DEMO · Simulated events and amounts. No payment, provider call or saved receipt.</div>}
      <h1 className="text-xl font-bold">run {id}</h1>
      {id.startsWith("demo_") ? <p>Demo status: {view.status} · all amounts and chain events below are simulated.</p> : <Outcome view={view} />}
      <ProtocolRail view={view} />
      <PolicyPanel view={view} />
      <WorkflowGraph view={view} />
      <GroupPanel view={view} />
      <EventLog view={view} />
    </main>
  );
}
