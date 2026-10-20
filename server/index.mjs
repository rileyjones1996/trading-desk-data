#!/usr/bin/env node
// Zero-dependency MCP server: JSON-RPC 2.0 over stdio (newline-delimited). Public, read-only endpoints only.
import { createInterface } from "node:readline";
import { TF, sessionAnchor, SESSION_LABEL, buildVwap } from "./session.mjs";
import { krakenInfo, okxInfo, hlInfo } from "./symbolinfo.mjs";

const num = (x) => (x === undefined || x === null || x === "" ? null : Number(x));

function parseSymbol(symbol) {
  // Keep Kraken xStocks suffix lowercase (AAPLx); everything else uppercased.
  const m = String(symbol).trim().split(/[\/\-_:]/).map((p) => p.replace(/^(.*?)(x?)$/i, (_, a, x) => a.toUpperCase() + (x && a.length > 1 && /x$/.test(p) ? "x" : x.toUpperCase())));
  if (m.length !== 2 || !m[0] || !m[1]) throw new Error(`Symbol must look like BTC/USD or BTC-USDT, got "${symbol}"`);
  return { base: m[0], quote: m[1] };
}
const isXStock = ({ base }) => /[A-Z0-9]x$/.test(base);
// xStocks (tokenized equities, e.g. AAPLx/USD) need asset_class=tokenized_asset on Kraken public endpoints.
const krakenParams = (s) => isXStock(s) ? { pair: `${s.base}/${s.quote}`, asset_class: "tokenized_asset" }
  : { pair: `${s.base === "BTC" ? "XBT" : s.base}${s.quote}` };
const okxInst = ({ base, quote }) => `${base}-${quote}`;

async function getJson(url) {
  const r = await fetch(url, { headers: { "User-Agent": "trading-desk-data/0.2.0" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).host}`);
  return r.json();
}
async function kraken(path, params) {
  const j = await getJson(`https://api.kraken.com/0/public/${path}?${new URLSearchParams(params)}`);
  if (j.error?.length) throw new Error(`Kraken: ${j.error.join("; ")}`);
  return j.result;
}
async function okx(path, params, group = "market") {
  const j = await getJson(`https://www.okx.com/api/v5/${group}/${path}?${new URLSearchParams(params)}`);
  if (j.code !== "0") throw new Error(`OKX: ${j.msg || j.code}`);
  return j.data;
}

async function hl(body) {
  const r = await fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`HTTP ${r.status} from api.hyperliquid.xyz`);
  return r.json();
}
// Hyperliquid perps are keyed by coin (BTC); quote is USD(C). Symbol BTC/USD, BTC-USDC, or BTC all map to coin BTC.
const hlCoin = (symbol) => String(symbol).includes("/") || String(symbol).includes("-") ? parseSymbol(symbol).base : String(symbol).trim().toUpperCase();

function check(exchange, timeframe) {
  if (!["kraken", "okx", "hyperliquid"].includes(exchange)) throw new Error(`exchange must be kraken, okx or hyperliquid`);
  if (timeframe !== undefined && !TF[timeframe]) throw new Error(`timeframe must be one of ${Object.keys(TF).join(", ")}`);
}

// Returns candles oldest-first. Only closed candles + the current forming one (flagged).
async function fetchCandles(exchange, symbol, timeframe, { limit, sinceMs } = {}) {
  const tf = TF[timeframe]; const s = exchange === "hyperliquid" ? null : parseSymbol(symbol);
  if (exchange === "kraken") {
    const params = { ...krakenParams(s), interval: tf.kraken };
    if (sinceMs) params.since = Math.floor(sinceMs / 1000) - 1;
    const res = await kraken("OHLC", params);
    const key = Object.keys(res).find((k) => k !== "last");
    let rows = res[key].map((r) => ({ ts: r[0] * 1000, open: num(r[1]), high: num(r[2]), low: num(r[3]), close: num(r[4]), volume: num(r[6]) }));
    if (sinceMs) rows = rows.filter((c) => c.ts >= sinceMs);
    return { pair: key, rows: limit ? rows.slice(-limit) : rows };
  }
  if (exchange === "hyperliquid") {
    const coin = hlCoin(symbol); const end = Date.now();
    const start = sinceMs ?? end - tf.ms * (limit ?? 300);
    const data = await hl({ type: "candleSnapshot", req: { coin, interval: timeframe, startTime: start, endTime: end } });
    if (!Array.isArray(data)) throw new Error("Hyperliquid: unexpected candleSnapshot response");
    let rows = data.map((c) => ({ ts: c.t, open: num(c.o), high: num(c.h), low: num(c.l), close: num(c.c), volume: num(c.v) }));
    if (sinceMs) rows = rows.filter((c) => c.ts >= sinceMs);
    return { pair: `${coin} (perp)`, rows: limit ? rows.slice(-limit) : rows };
  }
  const inst = okxInst(s); const out = []; let after;
  const want = limit ?? Infinity;
  for (let page = 0; page < 200 && out.length < want; page++) { // pages until the window is covered (200 pages ≈ 20k bars)
    const params = { instId: inst, bar: tf.okx, limit: String(Math.min(page === 0 ? 300 : 100, want - out.length)) };
    if (after) params.after = after;
    const data = await okx(page === 0 ? "candles" : "history-candles", params);
    if (!data.length) break;
    for (const r of data) out.push({ ts: Number(r[0]), open: num(r[1]), high: num(r[2]), low: num(r[3]), close: num(r[4]), volume: num(r[5]) });
    after = data[data.length - 1][0];
    if (sinceMs && Number(after) <= sinceMs) break;
  }
  let rows = out.reverse();
  if (sinceMs) rows = rows.filter((c) => c.ts >= sinceMs);
  return { pair: inst, rows };
}

const tools = {
  get_candles: {
    description: "OHLCV candles (oldest first) from Kraken or OKX public API. Candle = { ts (ms epoch, UTC open time), open, high, low, close, volume (base units) }. The last candle may still be forming.",
    inputSchema: { type: "object", required: ["exchange", "symbol", "timeframe"], properties: {
      exchange: { type: "string", enum: ["kraken", "okx", "hyperliquid"] }, symbol: { type: "string", description: "e.g. BTC/USD or BTC-USDT; Kraken xStocks like AAPLx/USD" },
      timeframe: { type: "string", enum: Object.keys(TF) }, limit: { type: "integer", minimum: 1, maximum: 300, default: 100 } } },
    async run({ exchange, symbol, timeframe, limit = 100 }) {
      check(exchange, timeframe);
      limit = Math.max(1, Math.min(300, Math.floor(limit)));
      const { pair, rows } = await fetchCandles(exchange, symbol, timeframe, { limit });
      return { exchange, symbol, venue_symbol: pair, timeframe, count: rows.length, candles: rows };
    },
  },
  get_last_price: {
    description: "Ticker = { exchange, symbol, last, bid, ask, ts } from the exchange public ticker. ts is ms epoch (Kraken has no ticker timestamp, so ts is fetch time).",
    inputSchema: { type: "object", required: ["exchange", "symbol"], properties: {
      exchange: { type: "string", enum: ["kraken", "okx", "hyperliquid"] }, symbol: { type: "string" } } },
    async run({ exchange, symbol }) {
      check(exchange);
      if (exchange === "hyperliquid") {
        const coin = hlCoin(symbol);
        const [mids, book] = await Promise.all([hl({ type: "allMids" }), hl({ type: "l2Book", coin })]);
        if (mids[coin] === undefined) throw new Error(`Hyperliquid: unknown coin ${coin}`);
        return { exchange, symbol, last: num(mids[coin]), bid: num(book.levels?.[0]?.[0]?.px), ask: num(book.levels?.[1]?.[0]?.px),
          ts: book.time ?? Date.now(), ts_source: "exchange", last_is: "mid price (allMids)" };
      }
      const s = parseSymbol(symbol);
      if (exchange === "kraken") {
        const res = await kraken("Ticker", krakenParams(s)); const t = Object.values(res)[0];
        return { exchange, symbol, last: num(t.c[0]), bid: num(t.b[0]), ask: num(t.a[0]), ts: Date.now(), ts_source: "fetch_time" };
      }
      const [t] = await okx("ticker", { instId: okxInst(s) });
      return { exchange, symbol, last: num(t.last), bid: num(t.bidPx), ask: num(t.askPx), ts: Number(t.ts), ts_source: "exchange" };
    },
  },
  get_session_vwap: {
    description: "Session VWAP from candles since the anchor. session=crypto (default, 00:00 UTC) or us_equity (09:30 America/New_York, last NYSE trading day); us_equity uses regular hours only (09:30-16:00 ET, 13:00 on early-close days). anchor (ISO) overrides. Output states anchor_used and built_from_timeframe. Uses typical price (H+L+C)/3 × volume.",
    inputSchema: { type: "object", required: ["exchange", "symbol", "timeframe"], properties: {
      exchange: { type: "string", enum: ["kraken", "okx", "hyperliquid"] }, symbol: { type: "string" }, timeframe: { type: "string", enum: Object.keys(TF) },
      session: { type: "string", enum: ["crypto", "us_equity"], default: "crypto" },
      anchor: { type: "string", description: "Optional ISO 8601 timestamp; overrides session start" } } },
    async run({ exchange, symbol, timeframe, session = "crypto", anchor }) {
      check(exchange, timeframe);
      if (!SESSION_LABEL[session] || session === "custom") throw new Error("session must be crypto or us_equity");
      let start, cal = {};
      if (anchor !== undefined) { start = Date.parse(anchor); if (!Number.isFinite(start) || start > Date.now()) throw new Error(`anchor must be a past ISO timestamp, got "${anchor}"`); }
      else { const { start: st, ...rest } = sessionAnchor(session); start = st; cal = rest; }
      return buildVwap({ exchange, symbol, timeframe, session, anchor, start, cal, now: Date.now(),
        fetch: (tf, sinceMs) => fetchCandles(exchange, symbol, tf, { sinceMs }) });
    },
  },
  get_symbol_info: {
    description: "Order-size and price rules from public metadata: SymbolInfo = { exchange, symbol, venue_symbol, min_qty, qty_step, price_tick, min_notional, source }. Fields the venue doesn't publish are null. OKX derivatives sizes are in contracts (qty_unit). Read-only.",
    inputSchema: { type: "object", required: ["exchange", "symbol"], properties: {
      exchange: { type: "string", enum: ["kraken", "okx", "hyperliquid"] }, symbol: { type: "string", description: "e.g. BTC/USD, BTC-USDT, BTC-USDT-SWAP, AAPLx/USD, or BTC (Hyperliquid)" } } },
    async run({ exchange, symbol }) {
      check(exchange);
      if (exchange === "hyperliquid") {
        const coin = hlCoin(symbol); const meta = await hl({ type: "meta" });
        const u = meta.universe?.find((x) => x.name === coin); if (!u) throw new Error(`Hyperliquid: unknown coin ${coin}`);
        return hlInfo(symbol, u);
      }
      if (exchange === "okx") {
        const id = String(symbol).trim().toUpperCase().replace(/[\/_:]/g, "-");
        const instType = /-SWAP$/.test(id) ? "SWAP" : "SPOT";
        const instId = instType === "SWAP" ? id : okxInst(parseSymbol(symbol));
        const [d] = await okx("instruments", { instType, instId }, "public"); if (!d) throw new Error(`OKX: unknown instrument ${instId}`);
        return okxInfo(symbol, d);
      }
      const s = parseSymbol(symbol);
      // AssetPairs filters xStocks by aclass_base (Ticker/OHLC use asset_class).
      const params = isXStock(s) ? { pair: `${s.base}/${s.quote}`, aclass_base: "tokenized_asset" } : krakenParams(s);
      const res = await kraken("AssetPairs", params); const [key, p] = Object.entries(res)[0] || [];
      if (!p) throw new Error(`Kraken: unknown pair ${symbol}`);
      return krakenInfo(symbol, key, p);
    },
  },
};

const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
async function handle(msg) {
  const { id, method, params = {} } = msg;
  const reply = (result) => id !== undefined && send({ jsonrpc: "2.0", id, result });
  const fail = (code, message) => id !== undefined && send({ jsonrpc: "2.0", id, error: { code, message } });
  if (method === "initialize") return reply({ protocolVersion: params.protocolVersion || "2025-06-18",
    capabilities: { tools: {} }, serverInfo: { name: "trading-desk-data", version: "0.2.0" } });
  if (method?.startsWith("notifications/")) return;
  if (method === "ping") return reply({});
  if (method === "tools/list") return reply({ tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) });
  if (method === "tools/call") {
    const t = tools[params.name]; if (!t) return fail(-32602, `Unknown tool ${params.name}`);
    try { const out = await t.run(params.arguments || {}); return reply({ content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out }); }
    catch (e) { return reply({ content: [{ type: "text", text: `Error: ${e.message}` }], isError: true }); }
  }
  return fail(-32601, `Method not found: ${method}`);
}
createInterface({ input: process.stdin }).on("line", (l) => {
  if (!l.trim()) return; let m;
  try { m = JSON.parse(l); } catch { return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
  handle(m);
});
