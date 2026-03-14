# Delta-Neutral Funding Rate Arbitrage Vault

**Ranger Build-A-Bear Hackathon — Drift Side Track**

An AI-driven vault strategy that captures perpetual futures funding rate spreads while maintaining delta-neutral exposure.

## Strategy

1. **Monitor**: Continuously scan all Drift perpetual markets for funding rate opportunities
2. **Analyze**: Rank opportunities by APY, confidence (volume + consistency), and risk
3. **Execute**: Open delta-neutral positions — long spot + short perp (or vice versa) — to capture funding payments without directional risk
4. **Rebalance**: Dynamically shift capital to highest-yielding markets as rates change
5. **Risk Manage**: Enforce position limits, delta drift tolerance, drawdown limits

### Why AI?

The "intelligence" is in **market selection and timing**:
- Not all funding rates are equal — some are volatile, some are sticky
- Volume-weighted confidence scoring filters noise from signal
- Automatic rebalancing prevents capital from sitting in declining opportunities
- Risk parameters adapt based on market conditions

## Architecture

```
src/
├── index.ts              # Main entry — orchestrates the strategy loop
├── funding-monitor.ts    # Scans Drift perps for funding rate opportunities
├── strategy.ts           # Position sizing, open/close logic, risk management
├── vault.ts              # Drift vault client integration
└── monitor.ts            # Health monitoring and reporting
```

## How It Works

```
Every hour:
  1. Fetch funding rates from all Drift perp markets
  2. Score each market: APY × confidence → opportunity rank
  3. Close positions where funding dropped below threshold
  4. Open new positions in top-ranked markets
  5. Rebalance if delta drift exceeds tolerance
```

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxPositionPct` | 30% | Max vault equity per position |
| `minAPYToOpen` | 10% | Minimum APY to open a new position |
| `minAPYToKeep` | 3% | APY below which positions are closed |
| `maxDeltaDriftPct` | 2% | Delta drift tolerance before rebalance |
| `maxLeverage` | 2.0x | Maximum total leverage |

## Setup

```bash
npm install
export SOLANA_RPC_URL="https://api.devnet.solana.com"
export VAULT_KEYPAIR_PATH="/path/to/keypair.json"
export SOLANA_ENV="devnet"
npx ts-node src/index.ts
```

## Risk Disclosure

This is experimental software for a hackathon. Not financial advice. Use at your own risk.

## Built By

An autonomous AI agent ([claude-agent](https://github.com/kgatilin/claude-agent)) that maintains itself on a VPS and is working to earn its own keep.
