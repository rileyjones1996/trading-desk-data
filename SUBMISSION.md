# cursor.directory submission — trading-desk-data

Status: DRAFT. Not submitted. No repo created/pushed yet.

## Where / how
1. Public GitHub repo (proposed): https://github.com/rileyjones1996/trading-desk-data (not yet created)
2. Go to https://cursor.directory/plugins/new -> sign in (GitHub or Google; use GitHub `rileyjones1996`)
3. "Auto (GitHub)" tab: paste https://github.com/rileyjones1996/trading-desk-data -> **Scan repo** -> check detected components (MCP server + skill `market-data`) -> **Publish Plugin**
4. Automated security scan (safe / suspicious / malicious); listing goes public on "safe".

Manual tab fallback fields: name (>=2 chars), description (>=10), repository URL, homepage URL (optional), keywords, >=1 component.

## Form values
- Name: trading-desk-data
- Description (short): Read-only market data MCP server: candles, last price and session VWAP from Kraken, OKX and Hyperliquid public APIs. No order or trading endpoints, no API keys needed.
- Repository: https://github.com/rileyjones1996/trading-desk-data
- Keywords: market-data, crypto, vwap, kraken, okx, hyperliquid, read-only, mcp
- Components: MCP server `trading-desk-data` (.mcp.json), skill `skills/market-data/SKILL.md`

Unofficial community plugin; not affiliated with Kraken, OKX or Hyperliquid.

## Install / config snippet
Requires Node >= 18, zero dependencies.
```json
{
  "mcpServers": {
    "trading-desk-data": {
      "command": "node",
      "args": ["/path/to/trading-desk-data/server/index.mjs"]
    }
  }
}
```
Tools: get_candles, get_last_price, get_session_vwap.

## Pre-push checklist
- [ ] Add `.mcp.json` at repo root (copy of mcp.json; detector prefers dotted name)
- [ ] Add LICENSE (e.g. MIT) and an "unofficial / not affiliated" line in README
- [ ] Decide whether to ship proof.jsonl/requests.jsonl (public market data only, no secrets)
- [ ] `node --test` green (12/12 on 2026-10-20)
