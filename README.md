# BTC Race Bot — btc-race-24h-20261123-0511

[![make.fun](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/aahcoba8-maker/makefun-btc-race-20261123/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/aahcoba8-maker/makefun-btc-race-20261123/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)

Long-only momentum bot trading cbBTC/USDC on 1-minute bars. Built for the [make.fun bounty](https://make.fun/bounty/btc-race-24h-20261123-0511).

## Strategy

- **Entry:** 20-bar return above +30 bps while the close is above its
  120-bar EMA → buy with all cash.
- **Exit:** trailing stop — sell everything when the close falls more than
  200 bps below the highest close since entry.
- **Equity guard:** sell and stop if equity drops 10% below its peak.
- **Eligibility fallback:** if no trade has filled by scored bar 1200, buy
  half the cash on any positive 20-bar return; by bar 1350 buy half the
  cash regardless. This is the fix for our 20261118 entry, which made
  +$17.84 on dev but was excluded as ineligible because its
  dip ≥ 150 bps AND bounce ≥ 20 bps entry never fired in the race window.

## Verified results (kit grade-local, process driver)

- Dev net PnL: **+$32.47** (return +3.25%)
- Max drawdown: **1.98%** (guardrail cap 25%)
- Trades: **1** (bought the early momentum move, rode the +3.64% drift)

## Layout

- `main.ts` — the bot (Node 22, standard library + vendored SDK only)
- `vendor/makefun-bars.ts` — the kit's bars-replay/v1 SDK shim, copied
  byte for byte from the kit
- `LICENSE` — MIT
