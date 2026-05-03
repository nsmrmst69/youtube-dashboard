"""
Gemini API を使って動画スケジュールデータを解析し、
優先度付きの Next Actions を生成するモジュール。

必要な環境変数（.env に記載）:
    GEMINI_API_KEY : Google AI Studio で取得したAPIキー
                     https://aistudio.google.com/app/apikey
"""
from __future__ import annotations

import logging
import os
import time
from datetime import date
from typing import Any

from google import genai

logger = logging.getLogger(__name__)

# 無料枠で使用可能なモデル（軽い順に試行）
GEMINI_MODELS = [
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash",
    "gemini-2.5-flash",
    "gemini-flash-latest",
]
_MAX_RETRIES = 2
_RETRY_WAIT = 30  # 秒（1回だけリトライ）


def generate_next_actions(videos: list[dict[str, Any]]) -> list[dict[str, str]]:
    """
    動画データを Gemini API に渡して Next Actions を生成する。

    Args:
        videos: sheets.get_sheet_data() の戻り値（日付フィルタ済み）

    Returns:
        Next Actionsのリスト。各要素は以下のキーを持つ辞書:
            priority : "high" / "medium" / "low"
            action   : アクション内容（日本語）
            reason   : 理由（日本語）

    Raises:
        ValueError: GEMINI_API_KEY が未設定の場合
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ValueError(
            ".env に GEMINI_API_KEY が設定されていません。\n"
            "取得: https://aistudio.google.com/app/apikey"
        )

    client = genai.Client(api_key=api_key)
    prompt = _build_prompt(videos)
    raw_text = _generate_with_retry(client, prompt)
    logger.info("Gemini API からレスポンス受信")

    return _parse_response(raw_text)


def _generate_with_retry(client: genai.Client, prompt: str) -> str:
    """
    モデルを順に試しながらリトライする。
    429エラー時は少し待ってから次のモデルを試す。
    """
    last_error = None
    for model in GEMINI_MODELS:
        try:
            logger.info(f"Gemini API ({model}) にリクエスト中...")
            response = client.models.generate_content(
                model=model,
                contents=prompt,
            )
            return response.text
        except Exception as e:
            last_error = e
            error_str = str(e)
            if "429" in error_str or "RESOURCE_EXHAUSTED" in error_str:
                # クォータ枯渇 → 次のモデルへ（長時間待機は避ける）
                logger.warning(f"クォータ制限 ({model}) → 次のモデルを試行...")
            else:
                logger.warning(f"モデル {model} でエラー: {e}")

    raise RuntimeError(f"全モデルでのNext Actions生成に失敗しました: {last_error}")


def _build_prompt(videos: list[dict[str, Any]]) -> str:
    """Gemini に送るプロンプトを組み立てる。"""
    today = date.today()

    lines = [
        f"今日は {today.strftime('%Y年%-m月%-d日')} です。",
        "以下はYouTubeチャンネル運営のディレクターが管理している動画制作スケジュールです。",
        "",
        "【動画一覧】",
    ]

    for v in videos:
        director_done = str(v.get('director_done', '')).upper() == 'TRUE'
        line = (
            f"- 公開日: {v.get('publish_date', '不明')}"
            f" | タイトル: {v.get('title', '不明')}"
            f" | 編集者: {v.get('editor', '未定')}"
            f" | ステータス: {v.get('status', '不明')}"
            f" | 依頼日: {v.get('request_date', '未')}"
            f" | 納品予定: {v.get('delivery_due', '未')}"
            f" | ディレクター公開作業完了: {'済' if director_done else '未'}"
        )
        lines.append(line)

    lines += [
        "",
        "【ステータスの意味】",
        "素材確認中: クライアントから届いた素材を確認中",
        "依頼する: 編集者への依頼が必要",
        "依頼中: 編集者に依頼済み、作業待ち",
        "編集中: 編集者が作業中",
        "確認中: ディレクター（私）が編集完了品を確認中",
        "先方確認中: クライアントが確認中",
        "修正中: 修正対応中",
        "公開作業: YouTubeへのアップロード・設定作業中",
        "  ※「公開作業」かつ「ディレクター公開作業完了: 済」の場合は、ディレクターの作業は完了しているが同僚のダブルチェックがまだのため、アクションは「同僚にダブルチェックを依頼する」とすること",
        "済: 完了",
        "",
        "【指示】",
        "上記のスケジュールを分析し、今日ディレクターがやるべき「Next Actions」を",
        "優先度の高い順に最大5件、以下の厳密なフォーマットで出力してください。",
        "説明文や前置きは不要です。フォーマット以外の文字は出力しないでください。",
        "",
        "フォーマット（1件ずつ、---で区切る）:",
        "PRIORITY: high|medium|low",
        "ACTION: （具体的なアクション内容を簡潔に）",
        "REASON: （優先する理由を簡潔に）",
        "---",
    ]

    return "\n".join(lines)


def _parse_response(raw_text: str) -> list[dict[str, str]]:
    """Gemini のレスポンステキストを構造化データに変換する。"""
    results = []
    blocks = raw_text.strip().split("---")

    for block in blocks:
        block = block.strip()
        if not block:
            continue

        item: dict[str, str] = {}
        for line in block.splitlines():
            line = line.strip()
            if line.startswith("PRIORITY:"):
                item["priority"] = line.replace("PRIORITY:", "").strip().lower()
            elif line.startswith("ACTION:"):
                item["action"] = line.replace("ACTION:", "").strip()
            elif line.startswith("REASON:"):
                item["reason"] = line.replace("REASON:", "").strip()

        if "action" in item and "priority" in item:
            # priorityの正規化
            if item["priority"] not in ("high", "medium", "low"):
                item["priority"] = "medium"
            results.append(item)

    if not results:
        logger.warning("Gemini のレスポンスをパースできませんでした。raw:\n" + raw_text)

    logger.info(f"Next Actions 生成完了: {len(results)} 件")
    return results
