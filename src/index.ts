/**
 * Delta-Neutral Funding Rate Arbitrage Vault
 *
 * An AI-driven vault strategy for the Ranger Build-A-Bear Hackathon.
 *
 * The strategy:
 * 1. Monitor funding rates across all Drift perp markets
 * 2. Identify markets where funding rate creates profitable arb opportunity
 * 3. Open delta-neutral positions (spot + perp hedge)
 * 4. Dynamically rebalance across markets as rates shift
 * 5. Close positions when opportunity diminishes
 *
 * This is the main entry point that ties together:
 * - funding-monitor.ts: Funding rate analysis
 * - strategy.ts: Position sizing and lifecycle
 * - vault.ts: Drift vault integration
 */

import { Keypair } from "@solana/web3.js";
import { BN, BASE_PRECISION } from "@drift-labs/sdk";
import {
  analyzeFundingOpportunities,
  selectPositions,
  formatOpportunities,
} from "./funding-monitor.js";
import {
  DEFAULT_CONFIG,
  calculatePositionSize,
  openDeltaNeutralPosition,
  identifyPositionsToClose,
  identifyPositionsToOpen,
  type ActivePosition,
  type StrategyConfig,
} from "./strategy.js";
import {
  initializeClients,
  getVaultEquity,
  type VaultConfig,
  DEFAULT_VAULT_CONFIG,
} from "./vault.js";

const REBALANCE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

async function main() {
  console.log("=== Delta-Neutral Funding Rate Arbitrage Vault ===\n");

  // Load configuration from environment
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  const keypairPath = process.env.VAULT_KEYPAIR_PATH;
  const vaultName = process.env.VAULT_NAME || "dn-funding-arb";
  const env = (process.env.SOLANA_ENV || "devnet") as "devnet" | "mainnet-beta";

  if (!keypairPath) {
    console.error("VAULT_KEYPAIR_PATH environment variable required");
    process.exit(1);
  }

  // Load keypair
  const keypairData = await import("fs").then((fs) =>
    JSON.parse(fs.readFileSync(keypairPath, "utf-8")),
  );
  const keypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  console.log(`Vault manager: ${keypair.publicKey.toBase58()}`);
  console.log(`Environment: ${env}`);
  console.log(`RPC: ${rpcUrl}\n`);

  // Initialize clients
  const vaultConfig: VaultConfig = {
    name: vaultName,
    rpcUrl,
    keypair,
    env,
    depositMarketIndex: DEFAULT_VAULT_CONFIG.depositMarketIndex!,
    redeemPeriod: DEFAULT_VAULT_CONFIG.redeemPeriod!,
    managementFee: DEFAULT_VAULT_CONFIG.managementFee!,
    profitShare: DEFAULT_VAULT_CONFIG.profitShare!,
  };

  console.log("Connecting to Drift...");
  const { driftClient, vaultClient } = await initializeClients(vaultConfig);
  console.log("Connected.\n");

  // Track active positions
  const activePositions: ActivePosition[] = [];
  const config: StrategyConfig = DEFAULT_CONFIG;

  // Main loop
  async function runCycle() {
    console.log(`\n--- Cycle at ${new Date().toISOString()} ---\n`);

    // 1. Analyze funding opportunities
    const opportunities = analyzeFundingOpportunities(driftClient);
    const topOpportunities = selectPositions(opportunities);
    console.log(formatOpportunities(topOpportunities));

    // 2. Check for positions to close
    const toClose = identifyPositionsToClose(
      activePositions,
      opportunities,
      config,
    );
    if (toClose.length > 0) {
      console.log(`\nClosing ${toClose.length} position(s)...`);
      for (const pos of toClose) {
        console.log(`  Closing ${pos.symbol} (funding dropped below threshold)`);
        // Close perp + spot positions
        const baseSizeBN = new BN(pos.perpSize * BASE_PRECISION.toNumber());
        // Reverse the position by trading opposite direction
        // (Implementation would call driftClient.placePerpOrder + placeSpotOrder)
        const idx = activePositions.indexOf(pos);
        if (idx !== -1) activePositions.splice(idx, 1);
      }
    }

    // 3. Check for new positions to open
    const toOpen = identifyPositionsToOpen(
      activePositions,
      opportunities,
      100_000, // TODO: get actual vault equity
      config,
    );
    if (toOpen.length > 0) {
      console.log(`\nOpening ${toOpen.length} new position(s)...`);
      for (const opp of toOpen) {
        const size = calculatePositionSize(opp, 100_000, config);
        console.log(
          `  Opening ${opp.symbol}: ${opp.direction} — $${size.quoteSize.toFixed(0)} (${size.baseSize.toFixed(4)} base)`,
        );

        const baseSizeBN = new BN(
          Math.floor(size.baseSize * BASE_PRECISION.toNumber()),
        );

        try {
          await openDeltaNeutralPosition(driftClient, opp, baseSizeBN);
          activePositions.push({
            perpMarketIndex: opp.perpMarketIndex,
            spotMarketIndex: opp.spotMarketIndex,
            symbol: opp.symbol,
            direction: opp.direction,
            perpSize: size.baseSize,
            spotSize: size.baseSize,
            entryPrice: opp.oraclePrice,
            entryFundingRate: opp.estimatedAPY,
            openedAt: Date.now(),
            accumulatedFunding: 0,
          });
        } catch (err) {
          console.error(`  Failed to open ${opp.symbol}:`, err);
        }
      }
    }

    // 4. Summary
    console.log(`\nActive positions: ${activePositions.length}`);
    for (const pos of activePositions) {
      console.log(
        `  ${pos.symbol}: ${pos.direction} — entry $${pos.entryPrice.toFixed(2)}, size ${pos.perpSize.toFixed(4)}`,
      );
    }
  }

  // Initial run
  await runCycle();

  // Schedule periodic rebalancing
  console.log(`\nScheduling rebalance every ${REBALANCE_INTERVAL_MS / 60000} minutes...`);
  setInterval(runCycle, REBALANCE_INTERVAL_MS);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
