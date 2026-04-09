"""
HTMLファイルをPNG・PDFとして出力するモジュール。
STEP1: template.html → output/dashboard.png / dashboard.pdf
STEP3以降: レンダリング済みHTMLを受け取って出力
"""
from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path
from typing import Optional

from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError

SCREENSHOT_WIDTH = 1400  # full_page=True のため height は出力サイズに影響しない
TIMEOUT_MS = 30_000

logger = logging.getLogger(__name__)


def _setup_logging():
    log_dir = Path(__file__).parent / "logs"
    log_dir.mkdir(exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.FileHandler(log_dir / "dashboard.log", encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
    )


async def take_screenshot_from_html(
    html_path: Path,
    output_path: Optional[Path] = None,
    pdf_path: Optional[Path] = None,
) -> tuple[Path, Optional[Path]]:
    """
    指定したHTMLファイルをPNG（必須）とPDF（任意）として出力する。
    ブラウザを1回起動して両方を生成するため効率的。

    Args:
        html_path  : 入力HTMLファイルのパス
        output_path: 出力PNGのパス（省略時は output/dashboard.png）
        pdf_path   : 出力PDFのパス（省略時はPDF出力しない）

    Returns:
        (png_path, pdf_path) のタプル。PDFなしの場合は (png_path, None)

    Raises:
        FileNotFoundError: HTMLファイルが存在しない場合
        PlaywrightTimeoutError: ページ読み込みがタイムアウトした場合
        RuntimeError: その他の出力失敗
    """
    if not html_path.exists():
        raise FileNotFoundError(f"テンプレートが見つかりません: {html_path}")

    if output_path is None:
        output_path = html_path.parent / "output" / "dashboard.png"

    output_path.parent.mkdir(exist_ok=True)

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            page = await browser.new_page(
                viewport={"width": SCREENSHOT_WIDTH, "height": 1}
            )
            await page.goto(
                f"file://{html_path.resolve()}",
                timeout=TIMEOUT_MS,
            )
            await page.wait_for_load_state("networkidle", timeout=TIMEOUT_MS)

            # PNG 出力
            await page.screenshot(path=str(output_path), full_page=True)
            logger.info(f"PNG出力完了: {output_path}")

            # PDF 出力（pdf_path が指定されている場合のみ）
            if pdf_path is not None:
                pdf_path.parent.mkdir(exist_ok=True)
                await page.pdf(
                    path=str(pdf_path),
                    print_background=True,   # 背景色・背景画像を含める
                    prefer_css_page_size=False,
                    width="1400px",
                )
                logger.info(f"PDF出力完了: {pdf_path}")

            await browser.close()

        return output_path, pdf_path

    except PlaywrightTimeoutError as e:
        logger.error(f"ページ読み込みタイムアウト（{TIMEOUT_MS}ms）: {e}")
        raise
    except Exception as e:
        logger.exception(f"出力失敗: {e}")
        raise RuntimeError(f"ファイル出力に失敗しました: {e}") from e


async def _main():
    _setup_logging()
    html_path = Path(__file__).parent / "template.html"
    output_dir = html_path.parent / "output"
    await take_screenshot_from_html(
        html_path,
        output_path=output_dir / "dashboard.png",
        pdf_path=output_dir / "dashboard.pdf",
    )


if __name__ == "__main__":
    asyncio.run(_main())
