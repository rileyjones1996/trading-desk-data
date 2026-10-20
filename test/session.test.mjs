import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionAnchor, buildVwap, CAL_YEARS, TF } from "../server/session.mjs";

const at = (iso) => Date.parse(iso);
const us = (iso) => { const r = sessionAnchor("us_equity", at(iso)); return { ...r, anchor: new Date(r.start).toISOString() }; };

test("holiday: Thanksgiving 2026 anchors to prior trading day with market_closed_today", () => {
  const r = us("2026-11-26T17:00:00Z");
  assert.equal(r.market_closed_today, true); assert.equal(r.holiday, "Thanksgiving Day");
  assert.equal(r.trading_day, "2026-11-25"); assert.equal(r.anchor, "2026-11-25T14:30:00.000Z");
});
test("holiday: Christmas 2026 anchors to Dec 24 half day", () => {
  const r = us("2026-12-25T17:00:00Z");
  assert.equal(r.holiday, "Christmas Day"); assert.equal(r.trading_day, "2026-12-24"); assert.equal(r.early_close, "13:00 ET");
});
test("half day: day after Thanksgiving 2026 flags early close", () => {
  const r = us("2026-11-27T16:00:00Z");
  assert.equal(r.early_close, "13:00 ET"); assert.equal(r.market_closed_today, undefined); assert.equal(r.anchor, "2026-11-27T14:30:00.000Z");
});
test("DST start Mon after Mar 8 2026: Sun Mar 8 anchors to Fri Mar 6 EST open (14:30Z); Mon Mar 9 is EDT (13:30Z)", () => {
  assert.equal(us("2026-03-08T18:00:00Z").anchor, "2026-03-06T14:30:00.000Z");
  assert.equal(us("2026-03-09T15:00:00Z").anchor, "2026-03-09T13:30:00.000Z");
});
test("DST end Nov 1 2026: Sun Nov 1 anchors to Fri Oct 30 EDT (13:30Z); Mon Nov 2 is EST (14:30Z)", () => {
  assert.equal(us("2026-11-01T18:00:00Z").anchor, "2026-10-30T13:30:00.000Z");
  assert.equal(us("2026-11-02T16:00:00Z").anchor, "2026-11-02T14:30:00.000Z");
});
test("weekend and pre-open anchoring", () => {
  assert.equal(us("2026-10-17T15:00:00Z").anchor, "2026-10-16T13:30:00.000Z"); // Saturday
  assert.equal(us("2026-10-18T15:00:00Z").anchor, "2026-10-16T13:30:00.000Z"); // Sunday
  assert.equal(us("2026-10-19T12:00:00Z").anchor, "2026-10-16T13:30:00.000Z"); // Mon 08:00 ET
  assert.equal(us("2026-10-21T15:00:00Z").anchor, "2026-10-21T13:30:00.000Z"); // normal day
});
test("calendar covers the current year (fails when it needs a refresh)", () => {
  const y = new Date().getUTCFullYear();
  assert.ok(CAL_YEARS.includes(y), `NYSE calendar has ${CAL_YEARS.join(", ")} but not ${y}; update session.mjs from nyse.com`);
});

// Fixture candles: one bar per slot, price 100+i, volume 1, optionally with gaps.
function bars(start, n, tf, skip = new Set()) {
  const out = []; for (let i = 0; i < n; i++) if (!skip.has(i)) out.push({ ts: start + i * TF[tf].ms, open: 100 + i, high: 100 + i, low: 100 + i, close: 100 + i, volume: 1 });
  return out;
}
const START = at("2026-10-19T13:30:00Z");

test("us_equity RTH: drops after-hours bars and reports count", async () => {
  const now = at("2026-10-20T00:30:00Z"); // 11h after open
  const r = await buildVwap({ exchange: "okx", symbol: "X", timeframe: "1h", session: "us_equity", start: START, cal: {}, now,
    fetch: async (tf) => ({ pair: "X", rows: bars(START, 11, tf) }) });
  assert.equal(r.bars_expected, 7); assert.equal(r.bars_used, 7); assert.equal(r.bars_dropped_outside_rth, 4);
  assert.equal(r.window_end, "2026-10-19T20:00:00.000Z"); assert.equal(r.built_from_timeframe, "1h");
  assert.equal(r.vwap, 103); for (const k of ["anchor_used", "bars_used", "bars_expected", "built_from_timeframe"]) assert.ok(k in r);
});
test("half-day RTH window ends 13:00 ET", async () => {
  const s = at("2026-11-27T14:30:00Z");
  const r = await buildVwap({ exchange: "okx", symbol: "X", timeframe: "1h", session: "us_equity", start: s, cal: { early_close: "13:00 ET" }, now: at("2026-11-27T23:00:00Z"),
    fetch: async (tf) => ({ pair: "X", rows: bars(s, 8, tf) }) });
  assert.equal(r.window_end, "2026-11-27T18:00:00.000Z"); assert.equal(r.bars_used, 4); assert.equal(r.bars_dropped_outside_rth, 4);
});
test("gap fallback: missing 1m bar -> rebuilt from 5m", async () => {
  const now = START + 60 * 60e3 + 30e3;
  const r = await buildVwap({ exchange: "okx", symbol: "X", timeframe: "1m", anchor: "x", start: START, now,
    fetch: async (tf) => ({ pair: "X", rows: tf === "1m" ? bars(START, 61, "1m", new Set([17])) : bars(START, Math.ceil((now - START) / TF[tf].ms), tf) }) });
  assert.equal(r.built_from_timeframe, "5m"); assert.equal(r.bars_used, r.bars_expected); assert.match(r.notes[0], /1m: 60 of 61/);
});
test("Kraken 720-bar cap: 1m over 24h skipped, built from 5m", async () => {
  const now = START + 24 * 36e5; const seen = [];
  const r = await buildVwap({ exchange: "kraken", symbol: "X", timeframe: "1m", anchor: "x", start: START, now,
    fetch: async (tf) => { seen.push(tf); return { pair: "X", rows: bars(START, Math.ceil((now - START) / TF[tf].ms), tf) }; } });
  assert.deepEqual(seen, ["5m"]); assert.equal(r.built_from_timeframe, "5m"); assert.equal(r.bars_expected, 288);
});
test("incomplete data error when no timeframe covers the window", async () => {
  const now = START + 3 * 36e5 + 10 * 60e3;
  await assert.rejects(buildVwap({ exchange: "okx", symbol: "X", timeframe: "1m", anchor: "x", start: START, now,
    fetch: async (tf) => ({ pair: "X", rows: bars(START + 36e5, 2 * 36e5 / TF[tf].ms, tf) }) }), /incomplete data: 2 of 4 bars \(at 1h\)/);
});
