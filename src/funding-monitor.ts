/**
 * Funding Rate Monitor
 *
 * Monitors perpetual market funding rates on Drift to identify
 * the best delta-neutral arbitrage opportunities.
 *
 * Strategy: When funding rate is positive (longs pay shorts),
 * go long spot + short perp = collect funding while delta-neutral.
 * When funding rate is negative (shorts pay longs),
 * go short spot (borrow) + long perp = collect funding.
 */

import {
  DriftClient,
  PerpMarketAccount,
  SpotMarketAccount,
  BN,
  PRICE_PRECISION,
  FUNDING_RATE_PRECISION,
  convertToNumber,
  PerpMarketConfig,
  SpotMarketConfig,
  getMarketOrderParams,
  PositionDirection,
  OrderType,
  BASE_PRECISION,
  decodeName,
} from "@drift-labs/sdk";

export interface FundingOpportunity {
  perpMarketIndex: number;
  spotMarketIndex: number;
  symbol: string;
  fundingRate: number;          // Annualized %
  fundingRateHourly: number;    // Hourly rate
  direction: "long-spot-short-perp" | "short-spot-long-perp";
  estimatedAPY: number;
  oraclePrice: number;
  perpVolume24h: number;
  confidence: number;           // 0-1 score based on consistency
}

export interface MarketSnapshot {
  timestamp: number;
  opportunities: FundingOpportunity[];
}

/**
 * Analyze all perp markets and rank by funding rate opportunity.
 */
export function analyzeFundingOpportunities(
  driftClient: DriftClient,
): FundingOpportunity[] {
  const opportunities: FundingOpportunity[] = [];
  const perpMarkets = driftClient.getPerpMarketAccounts();

  for (const perpMarket of perpMarkets) {
    const marketIndex = perpMarket.marketIndex;

    // Get current funding rate
    const lastFundingRate = convertToNumber(
      perpMarket.amm.lastFundingRate,
      FUNDING_RATE_PRECISION,
    );

    // Skip markets with negligible funding
    if (Math.abs(lastFundingRate) < 0.0001) continue;

    // Get oracle price
    const oraclePrice = convertToNumber(
      perpMarket.amm.historicalOracleData.lastOraclePrice,
      PRICE_PRECISION,
    );

    // Annualize: funding is paid hourly on Drift, so APY = hourly * 24 * 365
    const hourlyRate = lastFundingRate;
    const annualizedRate = hourlyRate * 24 * 365 * 100; // as percentage

    // Determine direction
    // Positive funding = longs pay shorts → we want to be short perp + long spot
    // Negative funding = shorts pay longs → we want to be long perp + short spot
    const direction: FundingOpportunity["direction"] =
      lastFundingRate > 0
        ? "long-spot-short-perp"
        : "short-spot-long-perp";

    // Find corresponding spot market (convention: market 0=SOL, 1=BTC, etc.)
    // Spot market index usually matches or is marketIndex + 1 (USDC is 0)
    const spotMarketIndex = marketIndex + 1; // Rough mapping

    // Confidence score based on volume and funding consistency
    const volume24h = convertToNumber(
      perpMarket.amm.volume24H,
      new BN(10).pow(new BN(6)), // USDC precision
    );

    // Higher volume and higher absolute funding = higher confidence
    const volumeScore = Math.min(volume24h / 10_000_000, 1); // cap at $10M
    const fundingScore = Math.min(Math.abs(annualizedRate) / 100, 1); // cap at 100% APY
    const confidence = (volumeScore * 0.4 + fundingScore * 0.6);

    opportunities.push({
      perpMarketIndex: marketIndex,
      spotMarketIndex,
      symbol: decodeName(perpMarket.name),
      fundingRate: annualizedRate,
      fundingRateHourly: hourlyRate,
      direction,
      estimatedAPY: Math.abs(annualizedRate),
      oraclePrice,
      perpVolume24h: volume24h,
      confidence,
    });
  }

  // Sort by estimated APY (descending)
  return opportunities.sort((a, b) => b.estimatedAPY - a.estimatedAPY);
}

/**
 * Select the best opportunities for capital allocation.
 * Diversify across multiple markets to reduce risk.
 */
export function selectPositions(
  opportunities: FundingOpportunity[],
  maxPositions = 3,
  minAPY = 5,        // Minimum 5% APY to bother
  minConfidence = 0.3,
): FundingOpportunity[] {
  return opportunities
    .filter((o) => o.estimatedAPY >= minAPY && o.confidence >= minConfidence)
    .slice(0, maxPositions);
}

/**
 * Format opportunities for human-readable display.
 */
export function formatOpportunities(opportunities: FundingOpportunity[]): string {
  if (opportunities.length === 0) return "No funding opportunities above threshold.";

  const lines = opportunities.map((o, i) => {
    const dir = o.direction === "long-spot-short-perp" ? "Long Spot / Short Perp" : "Short Spot / Long Perp";
    return [
      `${i + 1}. ${o.symbol} (perp #${o.perpMarketIndex})`,
      `   Direction: ${dir}`,
      `   Funding Rate: ${o.fundingRateHourly.toFixed(6)}/hr (${o.fundingRate.toFixed(2)}% APY)`,
      `   Oracle Price: $${o.oraclePrice.toFixed(2)}`,
      `   24h Volume: $${(o.perpVolume24h / 1_000_000).toFixed(2)}M`,
      `   Confidence: ${(o.confidence * 100).toFixed(0)}%`,
    ].join("\n");
  });

  return `=== Funding Rate Opportunities ===\n\n${lines.join("\n\n")}`;
}
