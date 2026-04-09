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

from config import normalize_status

# 指数バックオフの設定（Google 公式推奨値）
_MAX_RETRIES = 5
_MAX_BACKOFF_SEC = 64

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]

# スプレッドシートの列名とPython変数名のマッピング
COLUMN_MAP = {
    "日時":                       "publish_date",
    "動画タイトル":                 "title",
    "外注編集者への編集依頼日時":     "request_date",
    "外注編集者名":                 "editor",
    "状況ステータス":               "status",
    "編集完了日":                   "complete_date",
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

    records = _get_records_with_backoff(sheet, sheet_name)
    logger.info(f"{len(records)} 行取得（シート: {sheet_name}）")

    result = []
    for i, row in enumerate(records, start=2):
        if not any(str(v).strip() for v in row.values()):
            continue

        normalized = _normalize_row(row, row_num=i)
        if normalized:
            result.append(normalized)

    logger.info(f"有効データ: {len(result)} 件")
    return result


def _get_records_with_backoff(sheet, sheet_name: str) -> list[dict]:
    """
    Google Sheets API からデータを取得する。429/5xx エラー時に指数バックオフでリトライ。

    アルゴリズム（Google 公式推奨）:
        wait = min(2^n + random(0, 1000ms), MAX_BACKOFF_SEC)
        n は失敗するたびに +1

    Raises:
        gspread.exceptions.APIError: MAX_RETRIES 回失敗した場合
    """
    for attempt in range(_MAX_RETRIES):
        try:
            return sheet.get_all_records()
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


def _normalize_row(row: dict, row_num: int) -> dict[str, Any] | None:
    """1行のデータをバリデーション・正規化して返す。問題行はNoneを返す。"""
    normalized: dict[str, Any] = {}

    for sheet_col, python_key in COLUMN_MAP.items():
        value = str(row.get(sheet_col, "")).strip()
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
