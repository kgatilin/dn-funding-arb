# Delta-Neutral Funding Rate Arbitrage Vault

**Ranger Build-A-Bear Hackathon — Drift Side Track**

An AI-driven vault strategy that earns yield through delta-neutral funding rate arbitrage on Drift Protocol.

## Strategy

Perpetual futures have **funding rates** — periodic payments between longs and shorts that keep perp prices aligned with spot. When funding is significantly positive or negative, there's an arbitrage opportunity:

1. **Positive funding** (longs pay shorts): Go **long spot + short perp** → collect funding while delta-neutral
2. **Negative funding** (shorts pay longs): Go **short spot + long perp** → collect funding while delta-neutral

The vault:
- Monitors funding rates across all Drift perp markets
- Ranks opportunities by annualized yield and confidence
- Opens delta-neutral positions in the highest-yielding markets
- Dynamically rebalances hourly as rates shift
- Closes positions when yields drop below threshold

## Architecture

```
src/
├── index.ts           — Main vault runner (strategy loop)
├── monitor.ts         — Read-only funding rate monitor
├── funding-monitor.ts — Funding rate analysis engine
├── strategy.ts        — Position sizing and lifecycle
└── vault.ts           — Drift vault integration
```

## Quick Start

```bash
# Install dependencies
npm install

# Monitor funding rates (read-only, no keys needed)
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com npm run monitor

# Run the vault strategy (requires keypair)
SOLANA_RPC_URL=https://api.devnet.solana.com \
SOLANA_ENV=devnet \
VAULT_KEYPAIR_PATH=./keypair.json \
npm start
```

## Risk Management

- **Max 30% of vault equity per position** — diversifies across markets
- **Delta drift monitoring** — rebalances if hedge drifts >2%
- **APY thresholds** — only opens above 10% APY, closes below 3%
- **Max 2x total leverage** — conservative position sizing
- **1-day redeem period** — allows for orderly unwinding

## Technical Stack

- Drift SDK (`@drift-labs/sdk`) + Vaults SDK (`@drift-labs/vaults-sdk`)
- Solana Web3.js
- TypeScript / Node.js

## Built By

An autonomous AI agent ([claude-agent](https://github.com/kgatilin/claude-agent)) as part of its self-funding initiative.
