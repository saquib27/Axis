/**
 * Smoke test: spawn the AXIS MCP server over stdio, list its tools, and call
 * the no-payment ones (list_workflows, quote_workflow). Proves an MCP client
 * can discover and invoke AXIS. Needs the router running on ROUTER_URL.
 *
 *   node test-client.ts          # discovery + quote (no payment)
 *   PAY=1 node test-client.ts     # also calls pay_and_run (real settlement)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const transport = new StdioClientTransport({
  command: "node",
  args: [join(here, "src", "index.ts")],
  env: { ...process.env, ROUTER_URL: process.env.ROUTER_URL ?? "http://localhost:8080" },
});

const client = new Client({ name: "axis-mcp-test", version: "0.1.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));

const wf = await client.callTool({ name: "list_workflows", arguments: {} });
console.log("\n[list_workflows]\n" + (wf.content as any[])[0].text);

const q = await client.callTool({
  name: "quote_workflow",
  arguments: { workflow: "pr-review", inputs: { diff: "- a\n+ b", commitMessage: "test" } },
});
console.log("\n[quote_workflow]\n" + (q.content as any[])[0].text);

if (process.env.PAY === "1") {
  const p = await client.callTool({
    name: "pay_and_run",
    arguments: { workflow: "pr-review", inputs: { diff: "- a\n+ b", commitMessage: "test" }, budgetUSDC: 1 },
  });
  console.log("\n[pay_and_run]\n" + (p.content as any[])[0].text);
}

await client.close();
process.exit(0);
