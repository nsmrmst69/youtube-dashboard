"""
定数・ステータス定義。
ステータスをEnumで管理することでスペルミスや想定外の値を防ぐ。
"""
from enum import Enum


class VideoStatus(str, Enum):
    MATERIAL_CHECK = "素材確認中"
    TO_REQUEST     = "依頼前"
    REQUESTED      = "依頼中"
    EDITING        = "編集中"
    DIRECTOR_CHECK = "ディレクター確認中"
    CLIENT_CHECK   = "クライアント確認中"
    REVISION       = "修正中"
    YOUTUBE_UPLOAD = "YouTube公開作業"
    DONE           = "完了"


def normalize_status(raw: str) -> VideoStatus:
    """
    スプレッドシートから取得したステータス文字列を正規化してEnumに変換する。
    前後の空白・全角スペースを除去してからマッチングする。

    Raises:
        ValueError: 未知のステータス値が渡された場合
    """
    cleaned = raw.strip().replace("\u3000", "")
    try:
        return VideoStatus(cleaned)
    except ValueError:
        valid = [s.value for s in VideoStatus]
        raise ValueError(
            f"未知のステータス値: {repr(raw)}\n有効な値: {valid}"
        )


# サマリーカードに表示するステータスと色の定義
SUMMARY_DISPLAY = [
    {"status": VideoStatus.DONE,           "color": "text-green-400"},
    {"status": VideoStatus.EDITING,        "color": "text-blue-400"},
    {"status": VideoStatus.CLIENT_CHECK,   "color": "text-orange-400"},
    {"status": VideoStatus.REVISION,       "color": "text-red-400"},
    {"status": VideoStatus.YOUTUBE_UPLOAD, "color": "text-purple-400"},
]

# 公開日が何日以内なら緊急ハイライトを付けるか
URGENT_DAYS_THRESHOLD = 3
