import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sectorFromSic } from "./sectors.ts";

describe("sectorFromSic", () => {
  it("maps the SIC codes of common holdings to sector-ETF sectors", () => {
    assert.equal(sectorFromSic("3674"), "Technology"); // semiconductors: NVDA, TSM
    assert.equal(sectorFromSic("3571"), "Technology"); // computers: AAPL
    assert.equal(sectorFromSic("7372"), "Technology"); // software: CDNS, PLTR
    assert.equal(sectorFromSic("2834"), "Health Care"); // pharmaceuticals
    assert.equal(sectorFromSic("6022"), "Financials"); // state banks
    assert.equal(sectorFromSic("6798"), "Real Estate"); // REITs
    assert.equal(sectorFromSic("1311"), "Energy"); // crude petroleum
    assert.equal(sectorFromSic("4911"), "Utilities"); // electric services
    assert.equal(sectorFromSic("3711"), "Consumer Discretionary"); // motor vehicles
    assert.equal(sectorFromSic("3724"), "Industrials"); // aircraft engines
  });

  it("returns undefined for codes that say nothing useful", () => {
    assert.equal(sectorFromSic(""), undefined);
    assert.equal(sectorFromSic("9995"), undefined);
  });
});
