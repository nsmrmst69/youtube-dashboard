"""
Chatwork API を使って画像ファイルをルームに送信するモジュール。

必要な環境変数（.env に記載）:
    CHATWORK_API_TOKEN    : ChatworkのAPIトークン
    CHATWORK_ROOM_IDS     : 送信先ルームIDをカンマ区切りで指定
                            例) 123456789,987654321
                            ※ 複数指定した場合は全ルームに送信する
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

CHATWORK_API_BASE = "https://api.chatwork.com/v2"


def send_report_image(image_path: Path, message: str = "") -> None:
    """
    ダッシュボード画像を Chatwork の全対象ルームに送信する。

    Args:
        image_path : 送信する画像ファイルのパス（PNG）
        message    : 画像と一緒に送るテキストメッセージ（省略可）

    Raises:
        ValueError : 環境変数が未設定の場合
        RuntimeError: API呼び出しが失敗した場合
    """
    api_token = os.environ.get("CHATWORK_API_TOKEN")
    room_ids_raw = os.environ.get("CHATWORK_ROOM_IDS", "")

    if not api_token:
        raise ValueError(
            ".env に CHATWORK_API_TOKEN が設定されていません。"
        )

    room_ids = [r.strip() for r in room_ids_raw.split(",") if r.strip()]
    if not room_ids:
        raise ValueError(
            ".env に CHATWORK_ROOM_IDS が設定されていません。\n"
            "例) CHATWORK_ROOM_IDS=123456789,987654321"
        )

    if not image_path.exists():
        raise FileNotFoundError(f"送信する画像が見つかりません: {image_path}")

    headers = {"X-ChatWorkToken": api_token}

    for room_id in room_ids:
        _upload_file(room_id, image_path, message, headers)


def _upload_file(
    room_id: str,
    image_path: Path,
    message: str,
    headers: dict,
) -> None:
    """
    Chatwork API の /rooms/{room_id}/files エンドポイントに画像をアップロードする。

    Chatwork API v2 ファイル送信仕様:
        POST /rooms/{room_id}/files
        Content-Type: multipart/form-data
        フォームフィールド:
            file    : バイナリ（画像ファイル）
            message : 添付メッセージ（任意）
    """
    url = f"{CHATWORK_API_BASE}/rooms/{room_id}/files"

    with open(image_path, "rb") as f:
        files = {"file": (image_path.name, f, "image/png")}
        data = {"message": message} if message else {}

        response = requests.post(url, headers=headers, files=files, data=data)

    if response.status_code != 200:
        raise RuntimeError(
            f"Chatwork API エラー (room: {room_id}, HTTP {response.status_code}): "
            f"{response.text}"
        )

    file_id = response.json().get("file_id", "unknown")
    logger.info(f"Chatwork 送信完了 (room: {room_id}, file_id: {file_id})")


def build_daily_message(generated_at: str) -> str:
    """日報メッセージのテキストを生成する。"""
    return f"[info][title]YouTube運営 日報 {generated_at}[/title]スプレッドシートの最新進捗です。[/info]"
