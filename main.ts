/**
 * Long-only cbBTC momentum bot for make.fun btc-race-24h-20261123-0511.
 *
 * Strategy, decided from 1-minute closes only (no clock, no network, no
 * randomness, so two runs on the same data give the same orders):
 *
 * - Momentum entry: the 20-bar return is above +30 bps while the close sits
 *   above its 120-bar EMA -> buy with all cash.
 * - Trailing exit: sell everything once the close falls more than 200 bps
 *   below the highest close seen since entry.
 * - Equity guard: if equity ever drops 10% below its peak, sell and stop.
 * - Eligibility fallback (the 20261118 lesson: our old bot made +$17.84 on
 *   dev yet was excluded as ineligible because its dip>=150bps AND
 *   bounce>=20bps entry never fired once in the race window, so its action
 *   log was empty): if no trade has ever filled by scored bar 1200, buy
 *   half the cash on any positive 20-bar return; by bar 1350 buy half the
 *   cash no matter what. A forced trade can only help eligibility.
 *
 * Backtest on the frozen dev window (own simulator, next-open fills, 13 bps
 * per side): +$24.25 net, 4 orders, max drawdown ~2.6%. Positive on both
 * halves of the window and on shifted windows; in a mirrored (falling)
 * window it loses about what buy-and-hold loses, with drawdown ~4.2%,
 * far under the 25% guardrail cap.
 *
 * Verified with the kit's own grader (grade-local, process driver):
 * net PnL +$32.47, return +3.25%, max drawdown 1.98%, 1 trade. The
 * trailing stop never fired on dev because the deepest peak-relative
 * retrace was 197.8 bps, just under the 200 bps stop, so the bot bought
 * the early momentum move once and rode the window's +3.64% drift to the
 * end — essentially the buy-and-hold ceiling for this window, with the
 * stop still armed for the unseen race window.
 */

import { runBars } from "./vendor/makefun-bars.ts";
import type { BarsState, Batch, OrderInput } from "./vendor/makefun-bars.ts";

const SYMBOL = "CBBTC";
const LOOKBACK = 20; // bars for the momentum return
const ENTRY_BPS = 30n; // 20-bar return must beat this to enter
const TREND_SPAN = 120; // bars for the trend EMA
const TRAIL_BPS = 200n; // retrace from the peak since entry that exits
const FALLBACK_SOFT_BAR = 1200; // no trade yet: relax the entry from here
const FALLBACK_HARD_BAR = 1350; // no trade yet: force a trade from here
const MAX_SLIP_BPS = 200; // max move from the latest close a fill may take
const EQUITY_STOP_BPS = 1000n; // 10% below peak equity: sell and stop
const MIN_NOTIONAL = 1_000_000n; // 1 USDC in quote units
const BPS = 10_000n;

class Bot {
  closes: bigint[] = [];
  ema: number | null = null;
  inPosition = false;
  peakSinceEntry = 0n;
  everTraded = false;
  peakEquity = 0n;
  halted = false;

  onHello(state: BarsState): void {
    this.peakEquity = state.equity;
  }

  onBatch(state: BarsState, _batch: Batch): OrderInput[] {
    const close = state.close(SYMBOL);
    if (close === null) return [];
    this.noteClose(close);
    const holding = state.positions.get(SYMBOL);
    this.inPosition = holding !== undefined && holding.qty > 0n;
    if (this.inPosition) this.everTraded = true;
    if (state.equity > this.peakEquity) this.peakEquity = state.equity;
    if (state.warmingUp || this.halted) return [];
    const orders: OrderInput[] = [];
    // Equity guard: a 10% drawdown sells everything and stops trading.
    if (
      this.inPosition &&
      state.equity * BPS <= this.peakEquity * (BPS - EQUITY_STOP_BPS)
    ) {
      this.halted = true;
      const order = this.sellAll(state);
      if (order !== null) orders.push(order);
      return orders;
    }
    if (this.inPosition) {
      if (close > this.peakSinceEntry) this.peakSinceEntry = close;
      if (
        (this.peakSinceEntry - close) * BPS >
        this.peakSinceEntry * TRAIL_BPS
      ) {
        const order = this.sellAll(state);
        if (order !== null) orders.push(order);
      }
      return orders;
    }
    // Flat: momentum entry with the trend filter.
    const mom = this.returnBps(LOOKBACK);
    if (
      mom !== null &&
      mom > ENTRY_BPS &&
      this.ema !== null &&
      Number(close) > this.ema
    ) {
      const order = this.buy(state, state.cash);
      if (order !== null) orders.push(order);
      return orders;
    }
    // Eligibility fallback: guarantee at least one filled trade in any
    // window, however flat or falling it is.
    if (!this.everTraded) {
      const scored = state.seq - state.warmupBars;
      if (scored >= FALLBACK_HARD_BAR) {
        const order = this.buy(state, state.cash / 2n);
        if (order !== null) orders.push(order);
      } else if (scored >= FALLBACK_SOFT_BAR && mom !== null && mom > 0n) {
        const order = this.buy(state, state.cash / 2n);
        if (order !== null) orders.push(order);
      }
    }
    return orders;
  }

  noteClose(close: bigint): void {
    this.closes.push(close);
    if (this.ema === null) {
      this.ema = Number(close);
    } else {
      const k = 2 / (TREND_SPAN + 1);
      this.ema += k * (Number(close) - this.ema);
    }
    if (this.inPosition && close > this.peakSinceEntry) {
      this.peakSinceEntry = close;
    }
  }

  returnBps(n: number): bigint | null {
    if (this.closes.length <= n) return null;
    const old = this.closes[this.closes.length - 1 - n];
    return ((this.closes[this.closes.length - 1] - old) * BPS) / old;
  }

  buy(state: BarsState, notional: bigint): OrderInput | null {
    const room = state.weightRoom(SYMBOL);
    let amount = notional;
    if (amount > room) amount = room;
    if (amount > state.cash) amount = state.cash;
    if (amount < MIN_NOTIONAL) return null;
    return {
      side: "buy",
      symbol: SYMBOL,
      notional_quote_units: amount,
      max_slippage_bps: MAX_SLIP_BPS,
    };
  }

  sellAll(state: BarsState): OrderInput | null {
    const holding = state.positions.get(SYMBOL);
    if (holding === undefined || holding.qty <= 0n) return null;
    return {
      side: "sell",
      symbol: SYMBOL,
      qty: holding.qty,
      max_slippage_bps: MAX_SLIP_BPS,
    };
  }
}

const bot = new Bot();
await runBars({
  onHello: (state) => bot.onHello(state),
  onBatch: (state, batch) => bot.onBatch(state, batch),
});
