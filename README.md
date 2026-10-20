# trading-desk-data (v0.1.0)

Unofficial; not affiliated with Kraken, OKX, or Hyperliquid. Read-only, no order endpoints.

A read-only market-data plugin for Riley's trading desk. **Phase 1:** public, no-auth endpoints only. **It has no order or trading endpoints.**

Server: `server/index.mjs` is a zero-dependency Node (>=18) MCP server. It speaks JSON-RPC 2.0 over stdio (newline-delimited) and uses the built-in `fetch`.

| Tool | Args | Returns |
|---|---|---|
| get_candles | exchange `kraken\|okx\|hyperliquid`, symbol, timeframe `1m\|5m\|15m\|1h`, limit ≤300 | `Candle[] = { ts, open, high, low, close, volume }`, oldest first, with ts in ms UTC |
| get_last_price | exchange, symbol | `Ticker = { exchange, symbol, last, bid, ask, ts }` |
| get_session_vwap | exchange, symbol, timeframe, session `crypto\|us_equity` (default crypto), anchor (ISO, optional) | VWAP of typical price × volume since the anchor, plus `session`, `anchor_used`, `anchor_source`, `bars_used`, `bars_expected`, `built_from_timeframe` (and for us_equity `regular_hours_only`, `bars_dropped_outside_rth`) |

Endpoints: Hyperliquid `POST https://api.hyperliquid.xyz/info` (`candleSnapshot`, `allMids`, and `l2Book` for bid/ask; perps, so `last` is the mid). Kraken `/0/public/OHLC` and `/0/public/Ticker`; OKX `/api/v5/market/candles`, `history-candles` (paging for VWAP) and `ticker`.
Symbols: `BTC/USD`, `btc-usd` and `BTC_USD` all work. On Kraken, BTC maps to XBT. On OKX the form is `BASE-QUOTE`. Kraken xStocks use `AAPLx/USD` (sent with `asset_class=tokenized_asset`).

## Run / prove
```
node server/index.mjs < requests.jsonl
```
`proof.jsonl` holds real responses captured on 2026-10-19 (US Eastern).

## Session anchors
- `crypto`: 00:00 UTC today.
- `us_equity`: 09:30 America/New_York, DST-aware (13:30 UTC during EDT, 14:30 UTC during EST). Uses the open of the most recent NYSE trading day that has started: weekends and NYSE full-closure holidays are skipped.
  - On a holiday the output adds `market_closed_today: true` and `holiday: "<name>"`, and anchors to the last real trading day.
  - If the anchored day is an early-close day, the output adds `early_close: "13:00 ET"` and `early_close_reason`. VWAP is **not** cut at 13:00; xStocks keep trading.
  - `trading_day` (NY date) is always reported.
  - Calendar: hardcoded 2026–2027 from https://www.nyse.com/markets/hours-calendars (fetched 2026-10-19). Outside those years only weekends are skipped and a `calendar_warning` is added. Unscheduled closures are not covered.
- `anchor`: any past ISO 8601 timestamp; overrides `session`. Invalid or future values are rejected.

## VWAP completeness (never partial)
- Every bar slot from the anchor to the window end must be present. If any are missing, the tool retries at the next larger timeframe (5m, then 15m, then 1h) and reports `built_from_timeframe` plus `notes`.
- Kraken only serves the latest 720 bars, so timeframes that can't reach the anchor are skipped before fetching. OKX pages back through `history-candles` until the window is covered.
- If no timeframe covers the window, the tool returns an MCP tool error, `incomplete data: X of Y bars ...`, and **no VWAP number**.
- `us_equity` uses regular hours only: 09:30–16:00 ET, or 09:30–13:00 ET on early-close days. Bars outside that window are dropped and counted in `bars_dropped_outside_rth`.

## Tests
`node --test test/` runs a zero-dependency suite with fixture candles. It covers a holiday, a half day, the 2026 DST switch days (Mar 8 and Nov 1), weekend anchoring, regular-hours filtering, the gap fallback, the Kraken cap, the incomplete-data error, and a guard that fails when the current year isn't in the calendar.

## Known limits
- Kraken's ticker has no timestamp, so `ts` is the fetch time.
- VWAP uses OHLCV typical price, not trade-by-trade.
- xStocks are not the consolidated US tape. Their volume is thin and venue-specific, so a regular-hours VWAP on them is a proxy. Real stock candles are planned via Alpaca (see below).

## Phase 2 (designed, not built)
Account reads with read-only keys, declared as plugin variables and passed only as `${VAR}` placeholders in mcp.json `env`:
`KRAKEN_API_KEY`, `KRAKEN_API_SECRET` (permission: Query Funds/Query Closed Orders & Trades/Query Open Orders & Trades only, no Trade or Withdraw);
`OKX_API_KEY`, `OKX_API_SECRET`, `OKX_API_PASSPHRASE` (Read-only permission).
`HYPERLIQUID_WALLET_ADDRESS` (a public address, not a secret; `userFills`/`userFillsByTime` + `clearinghouseState` need no key).
Tools: `get_today_fills(exchange)` (Kraken `TradesHistory`, OKX `/api/v5/trade/fills`, HL `userFillsByTime` with `closedPnl`), `get_realized_pnl_today(exchange)` (sum per closed trade, loss count, daily total since 00:00 UTC), and `get_open_positions(exchange)` (Kraken `OpenPositions`, OKX `/api/v5/account/positions`, HL `clearinghouseState`). There is still no order endpoint. The server refuses to start if it detects a key with trade permission, where the exchange exposes that.
