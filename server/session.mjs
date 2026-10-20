// Pure session/calendar/VWAP logic. Zero dependencies; unit-tested in test/.
export const TF = { "1m": { kraken: 1, okx: "1m", ms: 60e3 }, "5m": { kraken: 5, okx: "5m", ms: 300e3 },
  "15m": { kraken: 15, okx: "15m", ms: 900e3 }, "1h": { kraken: 60, okx: "1H", ms: 3600e3 } };
// Parts of a UTC instant as seen in America/New_York.
export function nyParts(ms) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
  const o = Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, min: +o.minute, wd: o.weekday };
}
// 09:30 New York on a given NY calendar date -> UTC ms (DST-aware: tries EDT then EST).
function ny0930(y, m, d) {
  for (const off of [4, 5]) { const t = Date.UTC(y, m - 1, d, 9 + off, 30); const p = nyParts(t); if (p.h === 9 && p.min === 30 && p.d === d) return t; }
  throw new Error("could not resolve 09:30 America/New_York");
}
// NYSE full-closure holidays and 1:00 p.m. ET early closes.
// Source: https://www.nyse.com/markets/hours-calendars (fetched 2026-10-19). Update yearly.
export const NYSE_HOLIDAYS = {
  "2026-01-01": "New Year's Day", "2026-01-19": "Martin Luther King, Jr. Day", "2026-02-16": "Washington's Birthday",
  "2026-04-03": "Good Friday", "2026-05-25": "Memorial Day", "2026-06-19": "Juneteenth National Independence Day",
  "2026-07-03": "Independence Day (observed)", "2026-09-07": "Labor Day", "2026-11-26": "Thanksgiving Day", "2026-12-25": "Christmas Day",
  "2027-01-01": "New Year's Day", "2027-01-18": "Martin Luther King, Jr. Day", "2027-02-15": "Washington's Birthday",
  "2027-03-26": "Good Friday", "2027-05-31": "Memorial Day", "2027-06-18": "Juneteenth National Independence Day (observed)",
  "2027-07-05": "Independence Day (observed)", "2027-09-06": "Labor Day", "2027-11-25": "Thanksgiving Day", "2027-12-24": "Christmas Day (observed)",
};
export const NYSE_EARLY_CLOSE = { "2026-11-27": "Day after Thanksgiving", "2026-12-24": "Christmas Eve", "2027-11-26": "Day after Thanksgiving" };
export const CAL_YEARS = [2026, 2027];
const ymd = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export function sessionAnchor(session, now = Date.now()) {
  if (session === "crypto") { const n = new Date(now); return { start: Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()) }; }
  // us_equity: 09:30 NY open of the most recent NYSE trading day that has opened (weekends + NYSE holidays skipped).
  let p = nyParts(now); let day = Date.UTC(p.y, p.m - 1, p.d);
  const key = (pp) => ymd(pp.y, pp.m, pp.d);
  const closed = (pp) => pp.wd === "Sat" || pp.wd === "Sun" || !!NYSE_HOLIDAYS[key(pp)];
  const todayKey = key(p); const todayHoliday = NYSE_HOLIDAYS[todayKey];
  const out = {};
  if (todayHoliday) { out.market_closed_today = true; out.holiday = todayHoliday; }
  if (!CAL_YEARS.includes(p.y)) out.calendar_warning = `No NYSE holiday calendar for ${p.y}; only weekends skipped.`;
  if (closed(p) || p.h * 60 + p.min < 570) {
    do { day -= 864e5; p = nyParts(day + 12 * 36e5); } while (closed(p));
  }
  out.trading_day = key(p);
  if (NYSE_EARLY_CLOSE[out.trading_day]) { out.early_close = "13:00 ET"; out.early_close_reason = NYSE_EARLY_CLOSE[out.trading_day]; }
  out.start = ny0930(p.y, p.m, p.d);
  return out;
}
export const SESSION_LABEL = { crypto: "crypto, starts 00:00 UTC", us_equity: "us_equity, starts 09:30 America/New_York (DST-aware; weekends and NYSE holidays skipped)", custom: "custom anchor" };


const ORDER = Object.keys(TF);
const KRAKEN_CAP = 720;

/**
 * Build a VWAP over [start, min(now, end)). fetch(tf, sinceMs) -> { pair, rows } (oldest first).
 * Escalation: requested tf -> 5m -> 15m -> 1h until every bar slot in the window is present.
 * If no timeframe covers the window, throws "incomplete data: X of Y bars" (never returns a partial number).
 */
export async function buildVwap({ exchange, symbol, timeframe, session, anchor, start, cal = {}, now, fetch }) {
  const rth = anchor === undefined && session === "us_equity";
  const end = rth ? start + (cal.early_close ? 3.5 : 6.5) * 36e5 : Infinity;
  const windowEnd = Math.min(now, end);
  const slots = (tf) => Math.max(1, Math.ceil((windowEnd - start) / TF[tf].ms));
  const candidates = [timeframe, ...ORDER.filter((t) => TF[t].ms >= TF["5m"].ms && TF[t].ms > TF[timeframe].ms)];
  const notes = []; let last;
  for (const tf of candidates) {
    if (exchange === "kraken" && Math.ceil((now - start) / TF[tf].ms) + 1 > KRAKEN_CAP) {
      notes.push(`${tf}: Kraken returns only the latest ${KRAKEN_CAP} bars, which can't reach the anchor; skipped.`); continue;
    }
    const { pair, rows } = await fetch(tf, start);
    const inWindow = rows.filter((c) => c.ts >= start && c.ts < end);
    const dropped = rows.filter((c) => c.ts >= start).length - inWindow.length;
    const expected = slots(tf);
    // The bar opened at the current instant may not exist yet; tolerate only that one if the window is still open.
    const required = windowEnd === now && (now - start) % TF[tf].ms < 5000 ? expected - 1 : expected;
    const have = new Set(inWindow.map((c) => c.ts));
    const present = new Set(inWindow.map((c) => Math.floor((c.ts - start) / TF[tf].ms)).filter((i) => i >= 0 && i < expected)).size;
    last = { tf, present, expected };
    if (present < required) { notes.push(`${tf}: ${present} of ${expected} bars present; escalating.`); continue; }
    let pv = 0, v = 0; for (const c of inWindow) { pv += ((c.high + c.low + c.close) / 3) * c.volume; v += c.volume; }
    const out = { exchange, symbol, venue_symbol: pair, timeframe_requested: timeframe, built_from_timeframe: tf,
      session: anchor !== undefined ? SESSION_LABEL.custom : SESSION_LABEL[session], anchor_used: new Date(start).toISOString(),
      anchor_source: anchor !== undefined ? "anchor override" : `session=${session}`, ...cal,
      window_end: Number.isFinite(end) ? new Date(end).toISOString() : "now",
      vwap: v > 0 ? pv / v : null, volume: v, bars_used: inWindow.length, bars_expected: expected, complete: true,
      first_ts: inWindow[0]?.ts ?? null, last_ts: inWindow.at(-1)?.ts ?? null, method: "typical price (H+L+C)/3 weighted by volume" };
    if (rth) { out.regular_hours_only = true; out.bars_dropped_outside_rth = dropped; }
    if (notes.length) out.notes = notes;
    return out;
  }
  const x = last ? `${last.present} of ${last.expected} bars (at ${last.tf})` : `0 of ${slots(candidates.at(-1))} bars`;
  throw new Error(`incomplete data: ${x} since ${new Date(start).toISOString()}; tried ${candidates.join(", ")}. ${notes.join(" ")}`);
}
