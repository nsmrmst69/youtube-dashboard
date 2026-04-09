"""
YouTube 運営ダッシュボード 自動生成スクリプト（エントリーポイント）

使い方:
    python dashboard.py

必要な環境変数（.env ファイルに記載）:
    SPREADSHEET_ID    : スプレッドシートのID（必須）
    SHEET_NAME        : シート名（省略時: "スケジュール"）
    GOOGLE_CREDENTIALS: サービスアカウントJSONを1行に変換した文字列（推奨）
    CREDENTIALS_PATH  : credentials.json のパス（省略時: "credentials.json"、後方互換）
    DRIVE_FOLDER_ID   : アップロード先GoogleドライブフォルダID（省略時はアップロードしない）
"""
from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path

from dotenv import load_dotenv
import os

from sheets import get_sheet_data
from renderer import render_dashboard
from screenshot import take_screenshot_from_html, _setup_logging
from drive_upload import upload_dashboard

logger = logging.getLogger(__name__)


def main() -> None:
    _setup_logging()
    load_dotenv()

    # os.environ[] で取得（未設定時は即座にKeyErrorで失敗 → サイレント失敗を防ぐ）
    try:
        spreadsheet_id = os.environ["SPREADSHEET_ID"]
    except KeyError:
        logger.error(
            ".env に SPREADSHEET_ID が設定されていません。\n"
            ".env.example を参考に .env ファイルを作成してください。"
        )
        sys.exit(1)

    sheet_name = os.getenv("SHEET_NAME", "スケジュール")

    # 1. スプレッドシートからデータ取得
    try:
        videos = get_sheet_data(spreadsheet_id, sheet_name)
    except FileNotFoundError as e:
        logger.error(str(e))
        sys.exit(1)
    except Exception as e:
        logger.exception(f"スプレッドシート取得失敗: {e}")
        sys.exit(1)

    if not videos:
        logger.warning("データが0件でした。スプレッドシートの内容を確認してください。")

    # 2. HTMLレンダリング
    try:
        html = render_dashboard(videos)
    except Exception as e:
        logger.exception(f"HTMLレンダリング失敗: {e}")
        sys.exit(1)

    # 3. レンダリング済みHTMLを一時保存
    rendered_html = Path(__file__).parent / "output" / "dashboard_rendered.html"
    rendered_html.parent.mkdir(exist_ok=True)
    rendered_html.write_text(html, encoding="utf-8")

    # 4. PNG + PDF を同時出力（ブラウザ起動1回で両方生成）
    output_dir = Path(__file__).parent / "output"
    output_png = output_dir / "dashboard.png"
    output_pdf = output_dir / "dashboard.pdf"
    try:
        asyncio.run(
            take_screenshot_from_html(rendered_html, output_png, output_pdf)
        )
    except Exception as e:
        logger.exception(f"ファイル出力失敗: {e}")
        sys.exit(1)

    logger.info(f"ダッシュボード生成完了: PNG={output_png} / PDF={output_pdf}")

    # 5. Googleドライブにアップロード（DRIVE_FOLDER_ID が設定されている場合のみ）
    drive_folder_id = os.getenv("DRIVE_FOLDER_ID")
    if drive_folder_id:
        try:
            upload_dashboard(output_png, output_pdf, drive_folder_id)
        except Exception as e:
            logger.exception(f"Googleドライブへのアップロード失敗: {e}")
    else:
        logger.info("DRIVE_FOLDER_ID が未設定のためアップロードをスキップしました")


if __name__ == "__main__":
    main()
