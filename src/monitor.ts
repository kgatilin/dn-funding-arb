/**
 * Standalone Funding Rate Monitor
 *
 * Read-only tool that connects to Drift and displays current
 * funding rate opportunities. No trading, no keys needed.
 * Useful for evaluating the strategy before deploying capital.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";
import { DriftClient, Wallet } from "@drift-labs/sdk";
import {
  analyzeFundingOpportunities,
  selectPositions,
  formatOpportunities,
} from "./funding-monitor.js";

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const env = (process.env.SOLANA_ENV || "mainnet-beta") as "devnet" | "mainnet-beta";

  console.log("=== Drift Funding Rate Monitor ===\n");
  console.log(`RPC: ${rpcUrl}`);
  console.log(`Environment: ${env}\n`);

  const connection = new Connection(rpcUrl, "confirmed");
  // Read-only: use a dummy wallet
  const dummyKeypair = Keypair.generate();
  const wallet = new Wallet(dummyKeypair);

  console.log("Connecting to Drift...");
  const driftClient = new DriftClient({
    connection,
    wallet,
    env,
  });

  await driftClient.subscribe();
  console.log("Connected.\n");

  // Analyze opportunities
  const opportunities = analyzeFundingOpportunities(driftClient);
  console.log(`Found ${opportunities.length} markets with non-zero funding.\n`);

  // Show top opportunities
  const top = selectPositions(opportunities, 10, 1, 0.1);
  console.log(formatOpportunities(top));

  // Show summary stats
  if (opportunities.length > 0) {
    const avgAPY =
      opportunities.reduce((sum, o) => sum + o.estimatedAPY, 0) /
      opportunities.length;
    const maxAPY = opportunities[0].estimatedAPY;
    console.log(`\n=== Summary ===`);
    console.log(`Total markets analyzed: ${opportunities.length}`);
    console.log(`Average absolute funding APY: ${avgAPY.toFixed(2)}%`);
    console.log(`Best opportunity: ${maxAPY.toFixed(2)}% APY`);
    console.log(
      `Markets above 10% APY: ${opportunities.filter((o) => o.estimatedAPY >= 10).length}`,
    );
  }

  await driftClient.unsubscribe();
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
