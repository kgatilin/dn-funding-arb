/**
 * Delta-Neutral Strategy Engine
 *
 * Manages the actual position lifecycle:
 * 1. Open delta-neutral positions (spot + perp hedge)
 * 2. Monitor and rebalance when funding rates shift
 * 3. Close positions when opportunity diminishes
 *
 * Risk management:
 * - Maximum position size per market
 * - Minimum funding rate threshold
 * - Delta drift tolerance (rebalance if hedge drifts)
 * - Drawdown limits
 */

import {
  DriftClient,
  BN,
  PositionDirection,
  OrderType,
  getMarketOrderParams,
  BASE_PRECISION,
  QUOTE_PRECISION,
  convertToNumber,
  PRICE_PRECISION,
} from "@drift-labs/sdk";
import type { FundingOpportunity } from "./funding-monitor.js";

export interface StrategyConfig {
  /** Maximum % of vault equity per position */
  maxPositionPct: number;
  /** Minimum APY to open a new position */
  minAPYToOpen: number;
  /** APY below which we close the position */
  minAPYToKeep: number;
  /** Max delta drift before rebalancing (as % of position) */
  maxDeltaDriftPct: number;
  /** Maximum total leverage across all positions */
  maxLeverage: number;
}

export const DEFAULT_CONFIG: StrategyConfig = {
  maxPositionPct: 0.30,     // 30% of vault per position
  minAPYToOpen: 10,          // Only open above 10% APY
  minAPYToKeep: 3,           // Close if drops below 3%
  maxDeltaDriftPct: 0.02,   // 2% delta drift triggers rebalance
  maxLeverage: 2.0,          // Max 2x total leverage
};

export interface ActivePosition {
  perpMarketIndex: number;
  spotMarketIndex: number;
  symbol: string;
  direction: FundingOpportunity["direction"];
  perpSize: number;           // Base asset amount
  spotSize: number;           // Base asset amount
  entryPrice: number;
  entryFundingRate: number;   // APY at entry
  openedAt: number;           // Timestamp
  accumulatedFunding: number; // Total funding earned
}

/**
 * Calculate the position size for a given opportunity.
 */
export function calculatePositionSize(
  opportunity: FundingOpportunity,
  vaultEquity: number,
  config: StrategyConfig,
): { baseSize: number; quoteSize: number } {
  const maxQuote = vaultEquity * config.maxPositionPct;
  const baseSize = maxQuote / opportunity.oraclePrice;

  return {
    baseSize,
    quoteSize: maxQuote,
  };
}

/**
 * Generate the instructions to open a delta-neutral position.
 *
 * For "long-spot-short-perp":
 *   1. Buy spot asset
 *   2. Open short perp position of equal size
 *
 * For "short-spot-long-perp":
 *   1. Sell/borrow spot asset
 *   2. Open long perp position of equal size
 */
export async function openDeltaNeutralPosition(
  driftClient: DriftClient,
  opportunity: FundingOpportunity,
  baseSizeBN: BN,
): Promise<void> {
  const perpDirection =
    opportunity.direction === "long-spot-short-perp"
      ? PositionDirection.SHORT
      : PositionDirection.LONG;

  // Open perp position
  await driftClient.placePerpOrder(
    getMarketOrderParams({
      marketIndex: opportunity.perpMarketIndex,
      direction: perpDirection,
      baseAssetAmount: baseSizeBN,
    }),
  );

  // For the spot leg, we deposit/withdraw or swap through Drift's spot markets
  // In practice: if going long spot, we already hold the asset as collateral
  // If going short spot, we borrow through Drift's spot margin
  const spotDirection =
    opportunity.direction === "long-spot-short-perp"
      ? PositionDirection.LONG
      : PositionDirection.SHORT;

  await driftClient.placeSpotOrder(
    getMarketOrderParams({
      marketIndex: opportunity.spotMarketIndex,
      direction: spotDirection,
      baseAssetAmount: baseSizeBN,
    }),
  );
}

/**
 * Check if a position needs rebalancing.
 * Returns the delta drift as a percentage.
 */
export function checkDeltaDrift(
  position: ActivePosition,
  currentPerpSize: number,
  currentSpotSize: number,
): number {
  const totalExposure = Math.max(
    Math.abs(currentPerpSize),
    Math.abs(currentSpotSize),
  );
  if (totalExposure === 0) return 0;

  const netDelta = Math.abs(
    Math.abs(currentPerpSize) - Math.abs(currentSpotSize),
  );
  return netDelta / totalExposure;
}

/**
 * Determine which positions to close based on current funding rates.
 */
export function identifyPositionsToClose(
  positions: ActivePosition[],
  currentOpportunities: FundingOpportunity[],
  config: StrategyConfig,
): ActivePosition[] {
  const currentRates = new Map(
    currentOpportunities.map((o) => [o.perpMarketIndex, o]),
  );

  return positions.filter((pos) => {
    const current = currentRates.get(pos.perpMarketIndex);
    if (!current) return true; // Market disappeared, close

    // Close if funding rate dropped below threshold
    if (current.estimatedAPY < config.minAPYToKeep) return true;

    // Close if direction flipped (funding rate changed sign)
    if (current.direction !== pos.direction) return true;

    return false;
  });
}

/**
 * Determine which new positions to open.
 */
export function identifyPositionsToOpen(
  currentPositions: ActivePosition[],
  opportunities: FundingOpportunity[],
  vaultEquity: number,
  config: StrategyConfig,
): FundingOpportunity[] {
  const existingMarkets = new Set(
    currentPositions.map((p) => p.perpMarketIndex),
  );

  // Calculate current utilization
  const currentUtilization = currentPositions.length * config.maxPositionPct;
  const availableCapacity = 1 - currentUtilization;

  if (availableCapacity < config.maxPositionPct) return []; // No room

  return opportunities
    .filter((o) => !existingMarkets.has(o.perpMarketIndex))
    .filter((o) => o.estimatedAPY >= config.minAPYToOpen)
    .filter((o) => o.confidence >= 0.4)
    .slice(0, Math.floor(availableCapacity / config.maxPositionPct));
}
