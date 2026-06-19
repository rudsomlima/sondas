from http.server import BaseHTTPRequestHandler
import urllib.request
import urllib.error
import json
from datetime import datetime, timezone, timedelta
import re

GMT_MINUS_3 = timezone(timedelta(hours=-3))

STATION_ID = "82599"
REGION = "naconf"

def fetch_sounding_page(year: int, month: int) -> str:
    url = (
        f"https://weather.uwyo.edu/cgi-bin/sounding"
        f"?region={REGION}&TYPE=TEXT%3ALIST"
        f"&YEAR={year}&MONTH={month:02d}"
        f"&FROM=0100&TO=3123"
        f"&STNM={STATION_ID}"
    )
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; SondasNatal/1.0)",
        "Accept": "text/html,application/xhtml+xml",
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}: {e.reason}")
    except Exception as e:
        raise RuntimeError(str(e))


def parse_launches(html: str, year: int, month: int) -> list[dict]:
    """
    Parse sounding HTML and return list of launches with date/time info.
    Wyoming pages have headers like:
      <h2>Station number: 82599  Natal Aeroporto</h2>
      <h2>Observations at 00Z 01 Jun 2026</h2>
    """
    launches = []
    pattern = re.compile(
        r"Observations at\s+(\d{2})Z\s+(\d{2})\s+(\w+)\s+(\d{4})",
        re.IGNORECASE,
    )
    month_map = {
        "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4,
        "May": 5, "Jun": 6, "Jul": 7, "Aug": 8,
        "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12,
    }
    for m in pattern.finditer(html):
        hour_utc = int(m.group(1))
        day = int(m.group(2))
        mon_str = m.group(3)[:3].capitalize()
        yr = int(m.group(4))
        mon_num = month_map.get(mon_str, month)

        try:
            dt_utc = datetime(yr, mon_num, day, hour_utc, tzinfo=timezone.utc)
        except ValueError:
            continue

        dt_local = dt_utc.astimezone(GMT_MINUS_3)
        launches.append({
            "date": dt_local.strftime("%Y-%m-%d"),
            "time_local": dt_local.strftime("%H:%M"),
            "time_utc": dt_utc.strftime("%H:%MZ"),
            "day": dt_local.day,
            "month": dt_local.month,
            "year": dt_local.year,
        })

    return launches


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            # Parse query string manually
            path = self.path
            params = {}
            if "?" in path:
                qs = path.split("?", 1)[1]
                for part in qs.split("&"):
                    if "=" in part:
                        k, v = part.split("=", 1)
                        params[k] = v

            now_local = datetime.now(GMT_MINUS_3)

            action = params.get("action", "today")

            if action == "today":
                year = now_local.year
                month = now_local.month
                today_str = now_local.strftime("%Y-%m-%d")

                html = fetch_sounding_page(year, month)
                launches = parse_launches(html, year, month)
                today_launches = [l for l in launches if l["date"] == today_str]

                result = {
                    "today": today_str,
                    "station": STATION_ID,
                    "launched_today": len(today_launches) > 0,
                    "count": len(today_launches),
                    "launches": today_launches,
                    "all_this_month": launches,
                }

            elif action == "month":
                year = int(params.get("year", now_local.year))
                month = int(params.get("month", now_local.month))

                html = fetch_sounding_page(year, month)
                launches = parse_launches(html, year, month)

                result = {
                    "year": year,
                    "month": month,
                    "station": STATION_ID,
                    "count": len(launches),
                    "launches": launches,
                }

            elif action == "year":
                year = int(params.get("year", now_local.year))
                all_launches = []
                errors = []

                for m in range(1, 13):
                    # Don't fetch future months
                    if year == now_local.year and m > now_local.month:
                        break
                    try:
                        html = fetch_sounding_page(year, m)
                        launches = parse_launches(html, year, m)
                        all_launches.extend(launches)
                    except Exception as e:
                        errors.append({"month": m, "error": str(e)})

                result = {
                    "year": year,
                    "station": STATION_ID,
                    "count": len(all_launches),
                    "launches": all_launches,
                    "errors": errors,
                }

            else:
                result = {"error": "Unknown action"}

            body = json.dumps(result, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

        except Exception as e:
            err = json.dumps({"error": str(e)}).encode("utf-8")
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(err)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(err)

    def log_message(self, format, *args):
        pass  # Suppress default logging
