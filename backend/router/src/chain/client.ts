/** Algorand client + the agent account, from config. */
import { AlgorandClient } from "@algorandfoundation/algokit-utils/algorand-client";
import type { Config } from "../config.ts";

export function agentAccount(cfg: Config) {
  const algo = AlgorandClient.testNet();
  const agent = algo.account.fromMnemonic(cfg.AGENT_MNEMONIC);
  algo.setSignerFromAccount(agent);
  return { algo, agent };
}
