import { getMetricsPool, getSourceId, logScrape } from "../db/connection.js";
import { config } from "../config.js";

interface CoinGeckoMarket {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  market_cap: number;
  total_volume: number;
  price_change_24h: number;
  price_change_percentage_24h: number;
}

export async function scrapeCryptoPrices(): Promise<number> {
  const startedAt = new Date();
  const pool = getMetricsPool();

  try {
    const sourceId = await getSourceId("crypto_tracker");
    const ids = config.finance.cryptos.join(",");

    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc`,
      { headers: { "User-Agent": "MainScraper/1.0", "Accept": "application/json" } }
    );
    if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);

    const coins: CoinGeckoMarket[] = await res.json();
    let count = 0;

    for (const coin of coins) {
      await pool.execute(
        `INSERT INTO ticker_prices
         (source_id, symbol, ticker_type, price_usd, volume_24h, market_cap, change_pct_24h, recorded_at)
         VALUES (?, ?, 'crypto', ?, ?, ?, ?, NOW())`,
        [
          sourceId,
          coin.symbol.toUpperCase(),
          coin.current_price,
          coin.total_volume,
          coin.market_cap,
          coin.price_change_percentage_24h,
        ]
      );
      count++;
    }

    await logScrape("crypto", count, "success", startedAt);
    console.log(`[Finance] ${count} crypto prices recorded`);
    return count;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Finance] Crypto error:", msg);
    await logScrape("crypto", 0, "error", startedAt, msg);
    return 0;
  }
}

export async function scrapeStockPrices(): Promise<number> {
  const startedAt = new Date();
  const pool = getMetricsPool();

  try {
    if (!config.finance.finnhubApiKey) throw new Error("FINNHUB_API_KEY not configured");

    const sourceId = await getSourceId("stock_tracker");
    const symbols = config.finance.stocks;
    let count = 0;

    for (const symbol of symbols) {
      const res = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${config.finance.finnhubApiKey}`,
        { headers: { "User-Agent": "MainScraper/1.0" } }
      );
      if (!res.ok) throw new Error(`Finnhub error: ${res.status}`);

      const data = await res.json() as { c: number; dp: number };
      if (!data.c) continue; // no price (invalid symbol or market closed)

      const tickerType = ["SPY", "QQQ", "DIA", "IWM", "VTI", "VOO"].includes(symbol) ? "etf" : "stock";

      await pool.execute(
        `INSERT INTO ticker_prices
         (source_id, symbol, ticker_type, price_usd, volume_24h, market_cap, change_pct_24h, recorded_at)
         VALUES (?, ?, ?, ?, NULL, NULL, ?, NOW())`,
        [sourceId, symbol, tickerType, data.c, data.dp]
      );
      count++;
    }

    await logScrape("stocks", count, "success", startedAt);
    console.log(`[Finance] ${count} stock prices recorded`);
    return count;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Finance] Stocks error:", msg);
    await logScrape("stocks", 0, "error", startedAt, msg);
    return 0;
  }
}
