import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 4173);
const siteUrl = (process.env.SITE_URL || `http://localhost:${port}`).replace(/\/$/, "");
const decoder = new TextDecoder("euc-kr");

const demoStocks = [
  ["005930", "삼성전자", 87200, 6500, 8.05, 18438210],
  ["000660", "SK하이닉스", 238500, 17000, 7.67, 7149302],
  ["035420", "NAVER", 213000, 14500, 7.30, 2364104],
  ["035720", "카카오", 59200, 3900, 7.05, 5912288],
  ["005380", "현대차", 278000, 17500, 6.72, 1192480],
  ["051910", "LG화학", 438000, 26500, 6.44, 682301],
  ["068270", "셀트리온", 214500, 12500, 6.19, 1634880],
  ["373220", "LG에너지솔루션", 421000, 23500, 5.91, 502219],
  ["207940", "삼성바이오로직스", 910000, 48000, 5.57, 109322],
  ["105560", "KB금융", 87400, 4500, 5.43, 2130124],
  ["055550", "신한지주", 53600, 2700, 5.30, 1982344],
  ["012330", "현대모비스", 271500, 13000, 5.03, 421382],
  ["096770", "SK이노베이션", 126800, 5900, 4.88, 921114],
  ["066570", "LG전자", 113600, 5200, 4.79, 1402331],
  ["323410", "카카오뱅크", 28650, 1300, 4.75, 3467122],
  ["086790", "하나금융지주", 67100, 3000, 4.68, 1503911],
  ["009150", "삼성전기", 156200, 6900, 4.62, 592041],
  ["034020", "두산에너빌리티", 24650, 1050, 4.45, 8032210],
  ["003670", "포스코퓨처엠", 287000, 12000, 4.36, 650182],
  ["028260", "삼성물산", 153800, 6300, 4.27, 488912]
].map(([code, name, price, change, rate, volume]) => ({
  code,
  name,
  price,
  change,
  rate,
  volume,
  market: "KOSPI"
}));

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function numberFrom(text) {
  const cleaned = text.replace(/[^\d.-]/g, "");
  return cleaned ? Number(cleaned) : 0;
}

function stripTags(value) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNaverRisePage(html, market) {
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

  return rows.flatMap((row) => {
    const code = row.match(/code=(\d{6})/)?.[1];
    const name = stripTags(row.match(/<a[^>]*class=["']tltle["'][^>]*>[\s\S]*?<\/a>/i)?.[0] || "");
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => stripTags(match[1]));

    if (!code || !name || cells.length < 8) return [];

    return [{
      code,
      name,
      price: numberFrom(cells[2]),
      change: numberFrom(cells[3]),
      rate: numberFrom(cells[4]),
      volume: numberFrom(cells[5]),
      market
    }];
  });
}

async function fetchRiseStocks() {
  const markets = [["0", "KOSPI"], ["1", "KOSDAQ"]];
  const pages = await Promise.all(markets.map(async ([sosok, market]) => {
    const response = await fetch(`https://finance.naver.com/sise/sise_rise.naver?sosok=${sosok}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 real-time-stock/1.0",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
      }
    });

    if (!response.ok) {
      throw new Error(`Naver Finance responded with ${response.status}`);
    }

    const html = decoder.decode(await response.arrayBuffer());
    return parseNaverRisePage(html, market);
  }));

  const stocksByCode = new Map();
  pages.flat().forEach((stock) => {
    const current = stocksByCode.get(stock.code);
    if (!current || stock.rate > current.rate) {
      stocksByCode.set(stock.code, stock);
    }
  });

  const stocks = [...stocksByCode.values()]
    .filter((stock) => stock.price > 0 && stock.rate > 0)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 20);

  if (stocks.length < 10) {
    throw new Error("Could not parse enough rising stocks");
  }

  return stocks;
}

async function sendJson(res, payload, status = 200) {
  res.writeHead(status, {
    "Content-Type": mime[".json"],
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rawPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = normalize(rawPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    let file = await readFile(filePath);
    if ([".html", ".xml", ".txt"].includes(extname(filePath))) {
      file = Buffer.from(file.toString("utf8").replaceAll("__SITE_URL__", siteUrl), "utf8");
    }
    res.writeHead(200, {
      "Content-Type": mime[extname(filePath)] || "application/octet-stream"
    });
    res.end(file);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

createServer(async (req, res) => {
  if (req.method === "HEAD") {
    if (req.url?.startsWith("/api/rising")) {
      res.writeHead(200, {
        "Content-Type": mime[".json"],
        "Cache-Control": "no-store"
      });
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const rawPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const safePath = normalize(rawPath).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(publicDir, safePath);

    try {
      let file = await readFile(filePath);
      if ([".html", ".xml", ".txt"].includes(extname(filePath))) {
        file = Buffer.from(file.toString("utf8").replaceAll("__SITE_URL__", siteUrl), "utf8");
      }
      res.writeHead(200, {
        "Content-Type": mime[extname(filePath)] || "application/octet-stream",
        "Content-Length": file.length
      });
    } catch {
      res.writeHead(404);
    }
    res.end();
    return;
  }

  if (req.url?.startsWith("/api/rising")) {
    try {
      const stocks = await fetchRiseStocks();
      await sendJson(res, {
        source: "live",
        fetchedAt: new Date().toISOString(),
        stocks
      });
    } catch (error) {
      await sendJson(res, {
        source: "demo",
        fetchedAt: new Date().toISOString(),
        error: error.message,
        stocks: demoStocks
      });
    }
    return;
  }

  await serveStatic(req, res);
}).listen(port, () => {
  console.log(`Real-time stock dashboard: http://localhost:${port}`);
});
