import { test } from "node:test"; import assert from "node:assert/strict";
import { krakenInfo, okxInfo, hlInfo } from "../server/symbolinfo.mjs";
const KR_BTC = {"altname":"XBTUSD","wsname":"XBT/USD","pair_decimals":1,"lot_decimals":8,"ordermin":"0.00006","costmin":"0.5","tick_size":"0.1","status":"online"};
const KR_AAPLX = {"altname":"AAPLxUSD","wsname":"AAPLx/USD","aclass_base":"tokenized_asset","pair_decimals":2,"lot_decimals":8,"ordermin":"0.00000001","costmin":"0.5","tick_size":"0.01","status":"online"};
test("kraken BTC maps AssetPairs fields", () => {
  const r = krakenInfo("BTC/USD", "XXBTZUSD", KR_BTC);
  assert.deepEqual([r.min_qty, r.qty_step, r.price_tick, r.min_notional], [0.00006, 1e-8, 0.1, 0.5]);
});
test("kraken xStock AAPLx", () => {
  const r = krakenInfo("AAPLx/USD", "AAPLx/USD", KR_AAPLX);
  assert.deepEqual([r.venue_symbol, r.min_qty, r.qty_step, r.price_tick, r.min_notional], ["AAPLx/USD", 1e-8, 1e-8, 0.01, 0.5]);
});
test("kraken falls back to pair_decimals; missing costmin is null", () => {
  const { tick_size, costmin, ...p } = KR_BTC; const r = krakenInfo("BTC/USD", "X", p);
  assert.equal(r.price_tick, 0.1); assert.equal(r.min_notional, null); assert.match(r.source, /pair_decimals/);
});
test("okx spot", () => {
  const r = okxInfo("BTC-USDT", { instType: "SPOT", instId: "BTC-USDT", minSz: "0.00001", lotSz: "0.00000001", tickSz: "0.1", state: "live" });
  assert.deepEqual([r.min_qty, r.qty_step, r.price_tick, r.min_notional, r.qty_unit], [0.00001, 1e-8, 0.1, null, "base"]);
});
test("okx swap is in contracts", () => {
  const r = okxInfo("BTC-USDT-SWAP", { instType: "SWAP", instId: "BTC-USDT-SWAP", minSz: "0.01", lotSz: "0.01", tickSz: "0.1", ctVal: "0.01", ctValCcy: "BTC" });
  assert.equal(r.qty_unit, "contracts"); assert.equal(r.contract_value, 0.01);
});
test("okx missing fields stay null", () => {
  const r = okxInfo("X-Y", { instType: "SPOT", instId: "X-Y", minSz: "" }); assert.deepEqual([r.min_qty, r.qty_step, r.price_tick], [null, null, null]);
});
test("hyperliquid only szDecimals, rest null", () => {
  const r = hlInfo("BTC", { name: "BTC", szDecimals: 5 });
  assert.deepEqual([r.qty_step, r.min_qty, r.price_tick, r.min_notional], [1e-5, null, null, null]);
  assert.equal(hlInfo("X", { name: "X" }).qty_step, null);
});
