from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen
import json
import mimetypes
import os
import re
from datetime import datetime, timezone


BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = BASE_DIR / "public"
PORT = int(os.environ.get("PORT", "4173"))
SITE_URL = os.environ.get("SITE_URL", f"http://localhost:{PORT}").rstrip("/")

DEMO_STOCKS = [
    ("005930", "삼성전자", 87200, 6500, 8.05, 18438210),
    ("000660", "SK하이닉스", 238500, 17000, 7.67, 7149302),
    ("035420", "NAVER", 213000, 14500, 7.30, 2364104),
    ("035720", "카카오", 59200, 3900, 7.05, 5912288),
    ("005380", "현대차", 278000, 17500, 6.72, 1192480),
    ("051910", "LG화학", 438000, 26500, 6.44, 682301),
    ("068270", "셀트리온", 214500, 12500, 6.19, 1634880),
    ("373220", "LG에너지솔루션", 421000, 23500, 5.91, 502219),
    ("207940", "삼성바이오로직스", 910000, 48000, 5.57, 109322),
    ("105560", "KB금융", 87400, 4500, 5.43, 2130124),
    ("055550", "신한지주", 53600, 2700, 5.30, 1982344),
    ("012330", "현대모비스", 271500, 13000, 5.03, 421382),
    ("096770", "SK이노베이션", 126800, 5900, 4.88, 921114),
    ("066570", "LG전자", 113600, 5200, 4.79, 1402331),
    ("323410", "카카오뱅크", 28650, 1300, 4.75, 3467122),
    ("086790", "하나금융지주", 67100, 3000, 4.68, 1503911),
    ("009150", "삼성전기", 156200, 6900, 4.62, 592041),
    ("034020", "두산에너빌리티", 24650, 1050, 4.45, 8032210),
    ("003670", "포스코퓨처엠", 287000, 12000, 4.36, 650182),
    ("028260", "삼성물산", 153800, 6300, 4.27, 488912),
]


def demo_payload():
    stocks = [
        {
            "code": code,
            "name": name,
            "price": price,
            "change": change,
            "rate": rate,
            "volume": volume,
            "market": "KOSPI",
        }
        for code, name, price, change, rate, volume in DEMO_STOCKS
    ]
    return {"source": "demo", "fetchedAt": now_iso(), "stocks": stocks}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def strip_tags(value):
    value = re.sub(r"<script[\s\S]*?</script>", "", value, flags=re.I)
    value = re.sub(r"<style[\s\S]*?</style>", "", value, flags=re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    return (
        value.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .strip()
    )


def number_from(value):
    cleaned = re.sub(r"[^\d.-]", "", value)
    return float(cleaned) if "." in cleaned else int(cleaned or 0)


def parse_naver_rise_page(html, market):
    stocks = []
    for row in re.findall(r"<tr[^>]*>[\s\S]*?</tr>", html, flags=re.I):
        code_match = re.search(r"code=(\d{6})", row)
        name_match = re.search(r"<a[^>]*class=['\"]tltle['\"][^>]*>[\s\S]*?</a>", row, flags=re.I)
        cells = [strip_tags(cell) for cell in re.findall(r"<td[^>]*>([\s\S]*?)</td>", row, flags=re.I)]

        if not code_match or not name_match or len(cells) < 8:
            continue

        stocks.append(
            {
                "code": code_match.group(1),
                "name": strip_tags(name_match.group(0)),
                "price": number_from(cells[2]),
                "change": number_from(cells[3]),
                "rate": number_from(cells[4]),
                "volume": number_from(cells[5]),
                "market": market,
            }
        )
    return stocks


def fetch_rising_stocks():
    stocks_by_code = {}
    markets = (("0", "KOSPI"), ("1", "KOSDAQ"))

    for sosok, market in markets:
        request = Request(
            f"https://finance.naver.com/sise/sise_rise.naver?sosok={sosok}",
            headers={
                "User-Agent": "Mozilla/5.0 real-time-stock/1.0",
                "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
            },
        )
        with urlopen(request, timeout=8) as response:
            html = response.read().decode("euc-kr", errors="ignore")
            for stock in parse_naver_rise_page(html, market):
                current = stocks_by_code.get(stock["code"])
                if not current or stock["rate"] > current["rate"]:
                    stocks_by_code[stock["code"]] = stock

    stocks = list(stocks_by_code.values())
    stocks = [stock for stock in stocks if stock["price"] > 0 and stock["rate"] > 0]
    stocks.sort(key=lambda stock: stock["rate"], reverse=True)

    if len(stocks) < 10:
        raise ValueError("Could not parse enough rising stocks")

    return stocks[:20]


class Handler(BaseHTTPRequestHandler):
    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/api/rising"):
            try:
                self.send_json(
                    {
                        "source": "live",
                        "fetchedAt": now_iso(),
                        "stocks": fetch_rising_stocks(),
                    }
                )
            except (URLError, TimeoutError, ValueError, OSError) as error:
                payload = demo_payload()
                payload["error"] = str(error)
                self.send_json(payload)
            return

        raw_path = self.path.split("?", 1)[0]
        target = PUBLIC_DIR / ("index.html" if raw_path == "/" else raw_path.lstrip("/"))
        target = target.resolve()

        if not str(target).startswith(str(PUBLIC_DIR.resolve())):
            self.send_error(403)
            return

        if not target.exists() or not target.is_file():
            self.send_error(404)
            return

        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        body = target.read_bytes()
        if target.suffix in (".html", ".xml", ".txt"):
            body = body.decode("utf-8").replace("__SITE_URL__", SITE_URL).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_HEAD(self):
        if self.path.startswith("/api/rising"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return

        raw_path = self.path.split("?", 1)[0]
        target = PUBLIC_DIR / ("index.html" if raw_path == "/" else raw_path.lstrip("/"))
        target = target.resolve()

        if not str(target).startswith(str(PUBLIC_DIR.resolve())):
            self.send_error(403)
            return

        if not target.exists() or not target.is_file():
            self.send_error(404)
            return

        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        body = target.read_bytes()
        if target.suffix in (".html", ".xml", ".txt"):
            body = body.decode("utf-8").replace("__SITE_URL__", SITE_URL).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()


if __name__ == "__main__":
    server = ThreadingHTTPServer(("localhost", PORT), Handler)
    print(f"Real-time stock dashboard: http://localhost:{PORT}")
    server.serve_forever()
