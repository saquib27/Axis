import { serve } from "@hono/node-server";
import { loadConfig } from "./config.ts";
import { createApp } from "./app.ts";

const cfg = loadConfig();
const app = createApp(cfg);

// Recover any run left PENDING by a crash before serving traffic.
import { reconcilePending } from "./reconcile.ts";
await reconcilePending(cfg).then((n) => { if (n) console.log(JSON.stringify({ msg: "reconciled", runs: n })); }).catch((error) => console.error("payment reconciliation failed", error));

serve({ fetch: app.fetch, port: cfg.PORT }, (info) => {
  console.log(JSON.stringify({ msg: "router up", port: info.port, network: cfg.NETWORK }));
});
