/**
 * Drift Vault Integration
 *
 * Manages the Drift vault lifecycle:
 * - Initialize vault with proper parameters
 * - Connect VaultClient to manage positions
 * - Handle vault equity calculations
 * - Process depositor interactions
 */

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  DriftClient,
  Wallet,
  BN,
  initialize,
  QUOTE_PRECISION,
} from "@drift-labs/sdk";
import { VaultClient } from "@drift-labs/vaults-sdk";

export interface VaultConfig {
  name: string;
  /** RPC endpoint */
  rpcUrl: string;
  /** Vault manager keypair */
  keypair: Keypair;
  /** Environment: devnet or mainnet-beta */
  env: "devnet" | "mainnet-beta";
  /** Deposit market (0 = USDC) */
  depositMarketIndex: number;
  /** Redeem period in seconds (default: 1 day) */
  redeemPeriod: number;
  /** Management fee in basis points (e.g., 200 = 2%) */
  managementFee: number;
  /** Profit share in basis points (e.g., 2000 = 20%) */
  profitShare: number;
}

export const DEFAULT_VAULT_CONFIG: Partial<VaultConfig> = {
  depositMarketIndex: 0,  // USDC
  redeemPeriod: 86400,    // 1 day
  managementFee: 100,     // 1%
  profitShare: 1500,      // 15%
};

/**
 * Initialize Drift client and vault client.
 */
export async function initializeClients(
  config: VaultConfig,
): Promise<{ driftClient: DriftClient; vaultClient: VaultClient }> {
  const connection = new Connection(config.rpcUrl, "confirmed");
  const wallet = new Wallet(config.keypair);

  // Initialize Drift SDK
  const sdkConfig = initialize({ env: config.env });

  const driftClient = new DriftClient({
    connection,
    wallet,
    env: config.env,
  });

  await driftClient.subscribe();

  // Initialize Vault Client
  const vaultClient = new VaultClient({
    driftClient: driftClient as any, // SDK version mismatch between drift-sdk and vaults-sdk
    program: driftClient.program as any,
  });

  return { driftClient, vaultClient };
}

/**
 * Create a new vault on Drift.
 */
export async function createVault(
  vaultClient: VaultClient,
  config: VaultConfig,
): Promise<PublicKey> {
  const params = {
    name: Buffer.from(config.name.padEnd(32, "\0")).slice(0, 32) as any,
    spotMarketIndex: config.depositMarketIndex,
    redeemPeriod: new BN(config.redeemPeriod),
    maxTokens: new BN(0), // No cap
    managementFee: new BN(config.managementFee),
    profitShare: config.profitShare,
    hurdleRate: 0,
    permissioned: false,
    minDepositAmount: new BN(0),
  };

  const txSig = await vaultClient.initializeVault(params);
  console.log(`Vault created. Tx: ${txSig}`);

  // Derive vault address from name
  // The vault PDA is derived from the vault name
  const [vaultPubkey] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), Buffer.from(config.name)],
    vaultClient.program.programId,
  );

  return vaultPubkey;
}

/**
 * Get current vault equity in USDC.
 */
export async function getVaultEquity(
  vaultClient: VaultClient,
  vaultPubkey: PublicKey,
): Promise<number> {
  const vault = await vaultClient.getVault(vaultPubkey);
  // Calculate equity using the vault client's built-in method
  const equity = await vaultClient.calculateVaultEquity({
    vault,
  });

  return equity.toNumber() / QUOTE_PRECISION.toNumber();
}
