/**
 * Default scan universe for the quant tools: about 60 liquid US large caps
 * across every GICS sector, the eleven SPDR sector ETFs, and the four broad
 * index ETFs. The live harness scans these plus the watchlist and holdings;
 * simulations pass their own (possibly aliased) list instead.
 */

export const DEFAULT_UNIVERSE: readonly string[] = [
  // Technology
  "AAPL", "MSFT", "NVDA", "AVGO", "ADBE", "CRM", "AMD", "ORCL",
  // Communication services
  "META", "GOOGL", "NFLX", "DIS", "TMUS",
  // Consumer discretionary
  "AMZN", "TSLA", "HD", "MCD", "NKE", "BKNG",
  // Consumer staples
  "PG", "COST", "WMT", "KO", "PEP",
  // Health care
  "UNH", "JNJ", "LLY", "MRK", "ABBV", "PFE", "TMO",
  // Financials
  "JPM", "V", "MA", "BAC", "WFC", "GS", "MS",
  // Energy
  "XOM", "CVX", "EOG", "SLB", "COP",
  // Industrials
  "CAT", "HON", "UNP", "GE", "RTX", "LMT",
  // Materials
  "LIN", "SHW", "APD", "FCX", "NEM",
  // Utilities
  "NEE", "DUK", "SO", "AEP",
  // Real estate
  "AMT", "PLD", "EQIX",
  // Sector SPDRs
  "XLK", "XLV", "XLF", "XLY", "XLP", "XLE", "XLI", "XLB", "XLU", "XLRE", "XLC",
  // Broad index ETFs
  "SPY", "QQQ", "IWM", "DIA",
];

/** GICS sector of each default-universe member, when statically known. */
export const UNIVERSE_SECTORS: Readonly<Record<string, string>> = {
  AAPL: "Technology", MSFT: "Technology", NVDA: "Technology", AVGO: "Technology",
  ADBE: "Technology", CRM: "Technology", AMD: "Technology", ORCL: "Technology",
  XLK: "Technology",
  META: "Communication Services", GOOGL: "Communication Services", NFLX: "Communication Services",
  DIS: "Communication Services", TMUS: "Communication Services",
  XLC: "Communication Services",
  AMZN: "Consumer Discretionary", TSLA: "Consumer Discretionary", HD: "Consumer Discretionary",
  MCD: "Consumer Discretionary", NKE: "Consumer Discretionary", BKNG: "Consumer Discretionary",
  XLY: "Consumer Discretionary",
  PG: "Consumer Staples", COST: "Consumer Staples", WMT: "Consumer Staples",
  KO: "Consumer Staples", PEP: "Consumer Staples",
  XLP: "Consumer Staples",
  UNH: "Health Care", JNJ: "Health Care", LLY: "Health Care", MRK: "Health Care",
  ABBV: "Health Care", PFE: "Health Care", TMO: "Health Care",
  XLV: "Health Care",
  JPM: "Financials", V: "Financials", MA: "Financials", BAC: "Financials",
  WFC: "Financials", GS: "Financials", MS: "Financials",
  XLF: "Financials",
  XOM: "Energy", CVX: "Energy", EOG: "Energy", SLB: "Energy", COP: "Energy",
  XLE: "Energy",
  CAT: "Industrials", HON: "Industrials", UNP: "Industrials", GE: "Industrials",
  RTX: "Industrials", LMT: "Industrials",
  XLI: "Industrials",
  LIN: "Materials", SHW: "Materials", APD: "Materials", FCX: "Materials", NEM: "Materials",
  XLB: "Materials",
  NEE: "Utilities", DUK: "Utilities", SO: "Utilities", AEP: "Utilities",
  XLU: "Utilities",
  AMT: "Real Estate", PLD: "Real Estate", EQIX: "Real Estate",
  XLRE: "Real Estate",
  SPY: "Broad Market", QQQ: "Broad Market", IWM: "Broad Market", DIA: "Broad Market",
};
