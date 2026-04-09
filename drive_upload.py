"""
Google Drive への PNG アップロードモジュール。

アップロード戦略:
  1. dashboard.png  → 固定ファイル名で上書き（クライアント共有用・URLが変わらない）
  2. history/dashboard_YYYY-MM-DD.png → 日付付きで保存（履歴用）
  3. history/ 内で KEEP_DAYS 日より古いファイルを自動削除（容量を一定に保つ）
"""
from __future__ import annotations

import logging
import os
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

import json

logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.file",
]

FIXED_FILENAME = "dashboard.png"
HISTORY_SUBFOLDER = "history"
KEEP_DAYS = 7


def _build_drive_service():
    """Google Drive API サービスを構築して返す。"""
    credentials_json = os.environ.get("GOOGLE_CREDENTIALS")
    if credentials_json:
        try:
            creds = Credentials.from_service_account_info(
                json.loads(credentials_json), scopes=SCOPES
            )
        except (json.JSONDecodeError, ValueError) as e:
            raise ValueError(f"GOOGLE_CREDENTIALS の JSON が不正です: {e}")
    else:
        credentials_path = os.getenv("CREDENTIALS_PATH", "credentials.json")
        if not os.path.exists(credentials_path):
            raise FileNotFoundError(
                f"認証情報が見つかりません。\n"
                f"① .env に GOOGLE_CREDENTIALS を設定するか\n"
                f"② {credentials_path} を配置してください。"
            )
        creds = Credentials.from_service_account_file(credentials_path, scopes=SCOPES)

    return build("drive", "v3", credentials=creds)


def _get_or_create_folder(service, folder_name: str, parent_id: str) -> str:
    """
    指定した親フォルダ内にサブフォルダを取得または作成してIDを返す。
    """
    query = (
        f"name='{folder_name}' and "
        f"'{parent_id}' in parents and "
        f"mimeType='application/vnd.google-apps.folder' and "
        f"trashed=false"
    )
    results = service.files().list(q=query, fields="files(id, name)").execute()
    files = results.get("files", [])

    if files:
        return files[0]["id"]

    metadata = {
        "name": folder_name,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [parent_id],
    }
    folder = service.files().create(body=metadata, fields="id").execute()
    logger.info(f"フォルダ作成: {folder_name}")
    return folder["id"]


def _find_file(service, filename: str, parent_id: str) -> str | None:
    """指定フォルダ内のファイルIDを返す。存在しない場合はNone。"""
    query = (
        f"name='{filename}' and "
        f"'{parent_id}' in parents and "
        f"trashed=false"
    )
    results = service.files().list(q=query, fields="files(id)").execute()
    files = results.get("files", [])
    return files[0]["id"] if files else None


def _upload_or_update(service, png_path: Path, filename: str, parent_id: str) -> str:
    """
    ファイルが存在すれば上書き更新、なければ新規アップロードしてファイルIDを返す。
    """
    media = MediaFileUpload(str(png_path), mimetype="image/png", resumable=False)
    existing_id = _find_file(service, filename, parent_id)

    if existing_id:
        service.files().update(
            fileId=existing_id,
            media_body=media,
        ).execute()
        logger.info(f"上書き更新: {filename} (id={existing_id})")
        return existing_id
    else:
        metadata = {"name": filename, "parents": [parent_id]}
        file = service.files().create(
            body=metadata, media_body=media, fields="id"
        ).execute()
        logger.info(f"新規アップロード: {filename} (id={file['id']})")
        return file["id"]


def _delete_old_history(service, history_folder_id: str, keep_days: int) -> None:
    """
    history/ フォルダ内で keep_days 日より古いファイルを削除する。
    ファイル名の形式: dashboard_YYYY-MM-DD.png
    """
    cutoff = date.today() - timedelta(days=keep_days)

    results = service.files().list(
        q=f"'{history_folder_id}' in parents and trashed=false",
        fields="files(id, name)",
    ).execute()

    for f in results.get("files", []):
        name = f["name"]  # dashboard_2026-04-01.png
        try:
            date_str = name.replace("dashboard_", "").replace(".png", "")
            file_date = date.fromisoformat(date_str)
            if file_date < cutoff:
                service.files().delete(fileId=f["id"]).execute()
                logger.info(f"古い履歴を削除: {name}")
        except ValueError:
            logger.warning(f"日付パース失敗（スキップ）: {name}")


def upload_dashboard(
    png_path: Path,
    pdf_path: Optional[Path],
    folder_id: str,
) -> None:
    """
    PNG と PDF を Googleドライブにアップロードするメイン関数。

    Args:
        png_path  : アップロードするPNGファイルのパス
        pdf_path  : アップロードするPDFファイルのパス（None の場合スキップ）
        folder_id : アップロード先のGoogleドライブフォルダID

    処理内容:
        1. dashboard.png / dashboard.pdf を固定名で上書き（クライアント共有用）
        2. history/dashboard_YYYY-MM-DD.png / .pdf として履歴保存
        3. KEEP_DAYS 日より古い履歴ファイルを自動削除
    """
    if not png_path.exists():
        raise FileNotFoundError(f"アップロード対象のPNGが見つかりません: {png_path}")

    service = _build_drive_service()
    today_str = date.today().isoformat()

    # 1. 固定ファイル名で上書き
    _upload_or_update(service, png_path, "dashboard.png", folder_id)
    if pdf_path and pdf_path.exists():
        _upload_or_update(service, pdf_path, "dashboard.pdf", folder_id)

    # 2. 日付付きで履歴保存
    history_folder_id = _get_or_create_folder(service, HISTORY_SUBFOLDER, folder_id)
    _upload_or_update(service, png_path, f"dashboard_{today_str}.png", history_folder_id)
    if pdf_path and pdf_path.exists():
        _upload_or_update(service, pdf_path, f"dashboard_{today_str}.pdf", history_folder_id)

    # 3. 古い履歴を削除
    _delete_old_history(service, history_folder_id, KEEP_DAYS)

    logger.info(
        f"Googleドライブへのアップロード完了\n"
        f"  固定: dashboard.png / dashboard.pdf\n"
        f"  履歴: dashboard_{today_str}.png / .pdf\n"
        f"  フォルダID: {folder_id}"
    )
