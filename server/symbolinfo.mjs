// Pure mappers from public exchange metadata to SymbolInfo. Never invent values: null when the source doesn't publish it.
const n = (x) => (x === undefined || x === null || x === "" ? null : Number.isFinite(Number(x)) ? Number(x) : null);
const step = (d) => (Number.isInteger(d) && d >= 0 ? Number(`1e-${d}`) : null);

// Kraken /0/public/AssetPairs result entry.
export function krakenInfo(symbol, key, p) {
  const tick = n(p.tick_size);
  return { exchange: "kraken", symbol, venue_symbol: p.wsname || key, min_qty: n(p.ordermin), qty_step: step(p.lot_decimals),
    price_tick: tick ?? step(p.pair_decimals), min_notional: n(p.costmin), status: p.status ?? null,
    source: `https://api.kraken.com/0/public/AssetPairs (ordermin, lot_decimals, ${tick !== null ? "tick_size" : "pair_decimals"}, costmin)` };
}

// OKX /api/v5/public/instruments data[0].
export function okxInfo(symbol, d) {
  const contracts = d.instType !== "SPOT" && d.instType !== "MARGIN";
  return { exchange: "okx", symbol, venue_symbol: d.instId, min_qty: n(d.minSz), qty_step: n(d.lotSz), price_tick: n(d.tickSz), min_notional: null,
    ...(contracts ? { qty_unit: "contracts", contract_value: n(d.ctVal), contract_value_ccy: d.ctValCcy || null } : { qty_unit: "base" }),
    status: d.state ?? null, source: `https://www.okx.com/api/v5/public/instruments?instType=${d.instType} (minSz, lotSz, tickSz)` };
}

// Hyperliquid /info {type:"meta"} universe entry.
export function hlInfo(symbol, u) {
  return { exchange: "hyperliquid", symbol, venue_symbol: `${u.name} (perp)`, min_qty: null, qty_step: step(u.szDecimals), price_tick: null, min_notional: null,
    delisted: u.isDelisted === true, source: "https://api.hyperliquid.xyz/info {type:meta} (szDecimals)",
    notes: "meta publishes only szDecimals. No min size, fixed price tick, or min notional field is published there, so those are null. Prices are limited by significant-figure rules in Hyperliquid's docs, not a fixed tick." };
}
