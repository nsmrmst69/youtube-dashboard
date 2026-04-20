"""
Google Sheets からデータを取得するモジュール。
APIキーは .env ファイルで管理し、このファイルには含めない。
"""
from __future__ import annotations

import logging
import os
from typing import Any

import random
import time

import gspread
from google.oauth2.service_account import Credentials
import json

from datetime import date, datetime, timedelta
import re

from config import normalize_status, REPORT_DAYS

# 指数バックオフの設定（Google 公式推奨値）
_MAX_RETRIES = 5
_MAX_BACKOFF_SEC = 64

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]

# 列インデックス（0始まり）とPython変数名のマッピング
# 列名が重複しているためインデックスで直接指定する
# A=0, B=1, C=2, D=3, E=4, F=5, G=6, H=7, I=8, J=9, K=10 ...
COLUMN_INDEX_MAP = {
    0:  "publish_date",   # A列: 日時
    3:  "title",          # D列: 動画素材タイトル（メモ）
    5:  "editor",         # F列: 編集者
    7:  "request_date",   # H列: 依頼日
    8:  "delivery_due",   # I列: 納品予定日
    9:  "complete_date",  # J列: 納品日
    10: "status",         # K列: ステータス
}


def get_sheet_data(spreadsheet_id: str, sheet_name: str) -> list[dict[str, Any]]:
    """
    Google Sheets から動画スケジュールデータを取得して返す。

    Args:
        spreadsheet_id: スプレッドシートのID（URLの /d/～/edit の間の文字列）
        sheet_name: シート名

    Returns:
        各行を辞書にしたリスト。空行は除外済み。

    Raises:
        FileNotFoundError: credentials.json が存在しない場合
        gspread.exceptions.APIError: APIエラーの場合
        ValueError: 必須列が見つからない場合
    """
    credentials_json = os.environ.get("GOOGLE_CREDENTIALS")
    if credentials_json:
        try:
            creds = Credentials.from_service_account_info(
                json.loads(credentials_json), scopes=SCOPES
            )
        except (json.JSONDecodeError, ValueError) as e:
            raise ValueError(
                f"GOOGLE_CREDENTIALS の JSON が不正です: {e}\n"
                ".env の値を確認してください。"
            )
    else:
        # 環境変数がない場合はファイルにフォールバック（移行期間中の後方互換）
        credentials_path = os.getenv("CREDENTIALS_PATH", "credentials.json")
        if not os.path.exists(credentials_path):
            raise FileNotFoundError(
                f"認証情報が見つかりません。\n"
                f"① .env に GOOGLE_CREDENTIALS を設定するか\n"
                f"② {credentials_path} を配置してください。"
            )
        creds = Credentials.from_service_account_file(credentials_path, scopes=SCOPES)
    client = gspread.authorize(creds)

    try:
        sheet = client.open_by_key(spreadsheet_id).worksheet(sheet_name)
    except gspread.exceptions.WorksheetNotFound:
        raise ValueError(f"シートが見つかりません: {sheet_name}")

    all_values = _get_values_with_backoff(sheet, sheet_name)
    logger.info(f"{len(all_values)} 行取得（シート: {sheet_name}）")

    # 1行目・2行目はヘッダーなのでスキップ（3行目以降がデータ）
    data_rows = all_values[2:] if len(all_values) > 2 else []

    # 今日〜REPORT_DAYS日後の範囲でフィルタリング
    today = date.today()
    date_to = today + timedelta(days=REPORT_DAYS)
    logger.info(f"表示期間: {today} 〜 {date_to}（{REPORT_DAYS}日分）")

    result = []
    for i, row in enumerate(data_rows, start=3):
        if not any(str(v).strip() for v in row):
            continue

        normalized = _normalize_row_by_index(row, row_num=i)
        if not normalized:
            continue

        # 日付フィルタリング（パースできない行は含める）
        parsed_date = _parse_date(normalized.get("publish_date", ""))
        if parsed_date is None or (today <= parsed_date <= date_to):
            result.append(normalized)

    logger.info(f"有効データ: {len(result)} 件（{today} 〜 {date_to}）")
    return result


def _get_values_with_backoff(sheet, sheet_name: str) -> list[list]:
    """
    Google Sheets API から全データを2次元リストで取得する。
    列名の重複を避けるため get_all_records の代わりに get_all_values を使用。
    429/5xx エラー時に指数バックオフでリトライ。

    Raises:
        gspread.exceptions.APIError: MAX_RETRIES 回失敗した場合
    """
    for attempt in range(_MAX_RETRIES):
        try:
            return sheet.get_all_values()
        except gspread.exceptions.APIError as e:
            status_code = e.response.status_code if hasattr(e, "response") else 0
            is_retryable = status_code in (429, 500, 502, 503, 504)

            if not is_retryable or attempt == _MAX_RETRIES - 1:
                logger.error(f"APIエラー（リトライ終了）: {e}")
                raise

            wait = min(
                (2 ** attempt) + random.randint(0, 1000) / 1000,
                _MAX_BACKOFF_SEC,
            )
            logger.warning(
                f"APIエラー {status_code}（{attempt + 1}/{_MAX_RETRIES}回目）"
                f" → {wait:.1f}秒後にリトライ"
            )
            time.sleep(wait)

    return []


def _parse_date(raw: str) -> date | None:
    """
    日付文字列をパースして date オブジェクトを返す。
    対応フォーマット: 4/15/水曜日, 4/15(水), 4/15, 2026/4/15, 2026-04-15
    """
    cleaned = re.sub(r'/[月火水木金土日]曜日$', '', raw.strip())
    cleaned = cleaned.split("(")[0].split(" ")[0].strip()

    formats = ["%Y/%m/%d", "%Y-%m-%d", "%m/%d", "%Y年%m月%d日"]
    for fmt in formats:
        try:
            parsed = datetime.strptime(cleaned, fmt)
            if parsed.year == 1900:
                parsed = parsed.replace(year=date.today().year)
            return parsed.date()
        except ValueError:
            continue
    return None


def _normalize_row_by_index(row: list, row_num: int) -> dict[str, Any] | None:
    """1行のデータ（リスト）をインデックスで取得してバリデーション・正規化して返す。"""
    normalized: dict[str, Any] = {}

    for col_idx, python_key in COLUMN_INDEX_MAP.items():
        value = str(row[col_idx]).strip() if col_idx < len(row) else ""
        normalized[python_key] = value if value else "—"

    # ステータスのバリデーション
    raw_status = normalized.get("status", "")
    if raw_status and raw_status != "—":
        try:
            normalized["status"] = normalize_status(raw_status).value
            normalized["status_valid"] = True
        except ValueError as e:
            logger.warning(f"行 {row_num}: {e}（そのまま表示）")
            normalized["status_valid"] = False
    else:
        normalized["status_valid"] = False

    return normalized
