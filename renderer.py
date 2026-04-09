"""
Jinja2 を使ってダッシュボードHTMLを生成するモジュール。
"""
from __future__ import annotations

import logging
from collections import Counter
from datetime import datetime, date, timedelta
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

from config import VideoStatus, SUMMARY_DISPLAY, URGENT_DAYS_THRESHOLD

logger = logging.getLogger(__name__)

TEMPLATE_DIR = Path(__file__).parent / "templates"


def render_dashboard(videos: list[dict[str, Any]]) -> str:
    """
    動画データリストを受け取りダッシュボードHTMLを返す。

    Args:
        videos: sheets.get_sheet_data() の戻り値

    Returns:
        レンダリングされたHTML文字列
    """
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATE_DIR)),
        autoescape=select_autoescape(["html"]),  # XSS対策: スプレッドシート内のHTMLタグを無害化
    )

    summary = _build_summary(videos)
    videos_with_urgency = _mark_urgent(videos)

    html = env.get_template("dashboard.html.j2").render(
        videos=videos_with_urgency,
        summary=summary,
        summary_display=SUMMARY_DISPLAY,
        generated_at=datetime.now().strftime("%Y年%-m月%-d日 %H:%M"),
        statuses=[s.value for s in VideoStatus],
    )

    logger.info("HTMLレンダリング完了")
    return html


def _build_summary(videos: list[dict]) -> Counter:
    """ステータスごとの件数を集計する。"""
    return Counter(v.get("status", "") for v in videos)


def _mark_urgent(videos: list[dict]) -> list[dict]:
    """
    公開日が URGENT_DAYS_THRESHOLD 日以内の動画に urgent フラグを付与する。
    日付パースに失敗した場合は無視する。
    """
    today = date.today()
    threshold = today + timedelta(days=URGENT_DAYS_THRESHOLD)
    result = []

    for video in videos:
        v = dict(video)
        v["urgent"] = False
        v["days_until"] = None

        raw_date = v.get("publish_date", "")
        parsed = _try_parse_date(raw_date)
        if parsed:
            delta = (parsed - today).days
            if 0 <= delta <= URGENT_DAYS_THRESHOLD:
                v["urgent"] = True
                v["days_until"] = delta

        result.append(v)

    return result


def _try_parse_date(raw: str) -> date | None:
    """日付文字列をパースする。失敗したらNoneを返す。"""
    formats = [
        "%Y/%m/%d",
        "%Y-%m-%d",
        "%m/%d",
        "%Y年%m月%d日",
    ]
    for fmt in formats:
        try:
            parsed = datetime.strptime(raw.split(" ")[0].split("(")[0].strip(), fmt)
            if parsed.year == 1900:
                parsed = parsed.replace(year=date.today().year)
            return parsed.date()
        except ValueError:
            continue
    return None
