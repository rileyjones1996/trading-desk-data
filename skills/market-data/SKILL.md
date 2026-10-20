---
name: market-data
description: Read-only Kraken, OKX and Hyperliquid market data (candles, last price, session VWAP). Use when a trading check needs real prices.
---
# Market data (read-only)

- **get_candles**: OHLCV at the setup's timeframe (1m/5m/15m/1h, up to 300 candles) for swing highs/lows and 9/20 MAs. The last candle may still be forming.
- **get_last_price**: current last/bid/ask before judging an entry or stop.
- **get_session_vwap**: VWAP since the session anchor. `session: "crypto"` (default) starts at 00:00 UTC; `session: "us_equity"` starts at 09:30 New York (the last NYSE trading day's open; weekends and NYSE holidays skipped). Pass `anchor` (ISO) to override. Always quote `anchor_used` with the VWAP. Quote `built_from_timeframe` if it differs from the timeframe you asked for. If the tool returns `incomplete data`, report that and do not compute or estimate a VWAP yourself. `us_equity` VWAP is regular hours only. If `market_closed_today` is true, tell the user the market is closed (name the `holiday`) and that VWAP is from the prior session. If `early_close` is set, mention the 13:00 ET close.
- **get_symbol_info**: min order size (`min_qty`), size increment (`qty_step`), price tick (`price_tick`) and minimum order value (`min_notional`) from the venue's public metadata. Use it to round position sizes **down** to `qty_step` and check `min_qty`/`min_notional` before quoting a size. A `null` field means the venue doesn't publish it: say so, don't fill it in. OKX derivatives (`-SWAP`) sizes are in contracts (`qty_unit`, `contract_value`). Hyperliquid publishes only `szDecimals`.

Symbols: `BTC/USD` on Kraken, `BTC-USDT` on OKX, `BTC` (perp, USD) on Hyperliquid, whose `last` is the mid price. Kraken xStocks use `AAPLx/USD`. These are tokenized stocks that trade 24/7, not the NYSE/Nasdaq tape, so `us_equity` VWAP on them is anchored at the NY open but includes their thin after-hours prints.

Rules:
- Never make up, estimate, or "fill in" a number. If a tool errors or returns nothing, say so and stop that check.
- Report the exchange, symbol, and timestamp with every number you quote.
- This plugin cannot place, change, or cancel orders, and there are no account reads (phase 2).
