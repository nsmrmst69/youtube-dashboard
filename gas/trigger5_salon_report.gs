// ============================================================
//  トリガー⑤ オンラインサロン 公開完了報告 自動送信
//
//  【動作】
//  運営スケジュールシートの W列「公開設定」チェックボックスが
//  ON になった瞬間に、Chatwork チャンネル1（クライアント）へ
//  公開完了報告メッセージを自動送信する。
//
//  【使用列】
//  A列 : 日時
//  L列 : YouTube URL（完成動画）
//  S列 : 動画タイトル（DxD GOLF MONSTERS）
//  T列 : 投稿ページURL
//  U列 : Vimeo_URL
//  V列 : Vimeo_埋込コード
//  W列 : 公開設定（チェックボックス）← トリガー
// ============================================================


// ============================================================
//  ▼ 設定
//
//  APIトークン・ルームID・アカウントIDは コードに直接書かず
//  GASのスクリプトプロパティで管理します（セキュリティ対策）。
//
//  【スクリプトプロパティの設定方法】
//  GASエディタ → 左メニュー「プロジェクトの設定（歯車）」
//  →「スクリプト プロパティ」→「プロパティを追加」
//  以下のキーと値を登録してください：
//
//  キー                     値
//  ─────────────────────────────────────────────────
//  CHATWORK_API_TOKEN       （ChatworkのAPIトークン）
//  CLIENT_ROOM_ID           （チャンネル1のルームID）
//  TO_ACCOUNT_IDS           （例: 123456,789012  ← カンマ区切り）
//
// ============================================================
function getConfig_() {
  const props = PropertiesService.getScriptProperties();
  const toIds = props.getProperty('TO_ACCOUNT_IDS');

  return {
    CHATWORK_API_TOKEN: props.getProperty('CHATWORK_API_TOKEN'),
    CLIENT_ROOM_ID:     props.getProperty('CLIENT_ROOM_ID'),
    TO_ACCOUNT_IDS:     toIds ? toIds.split(',').map(function(s) { return s.trim(); }) : [],
  };
}

const CONFIG = {

  // ※ APIトークン・ルームID・アカウントIDは上の getConfig_() でプロパティから取得します

  // スプレッドシートのシート名
  SHEET_NAME: '運営スケジュール',

  // 各列の番号（A=1, B=2 … W=23）
  COL: {
    DATE:          1,   // A列: 日時
    YOUTUBE_URL:   12,  // L列: YouTube URL（完成動画）
    SALON_TITLE:   19,  // S列: 動画タイトル（DxD GOLF MONSTERS）
    POST_PAGE:     20,  // T列: 投稿ページURL
    VIMEO_URL:     21,  // U列: Vimeo_URL
    VIMEO_EMBED:   22,  // V列: Vimeo_埋込コード
    PUBLISH_CHECK: 23,  // W列: 公開設定（チェックボックス）
  },

  // 配信時間（固定）
  DELIVERY_TIME: '18:00',

  // ヘッダー行数（データは何行目から始まるか）
  HEADER_ROWS: 2,
};
// ▲ 設定ここまで
// ============================================================


// ============================================================
//  メイン：onEdit トリガー
//  ※ GASエディタで「トリガー追加」→「onEdit」を設定してください
// ============================================================
function onEditSalonReport(e) {
  const range = e.range;
  const sheet = range.getSheet();

  // 対象シート以外は無視
  if (sheet.getName() !== CONFIG.SHEET_NAME) return;

  // W列以外の編集は無視
  if (range.getColumn() !== CONFIG.COL.PUBLISH_CHECK) return;

  // チェックボックスがONになったときのみ処理（OFFにしても動かない）
  if (range.getValue() !== true) return;

  // ヘッダー行は無視
  const row = range.getRow();
  if (row <= CONFIG.HEADER_ROWS) return;

  // スクリプトプロパティから機密情報を取得
  const secrets = getConfig_();
  if (!secrets.CHATWORK_API_TOKEN || !secrets.CLIENT_ROOM_ID) {
    showAlert_('スクリプトプロパティが設定されていません。\nCHATWORK_API_TOKEN と CLIENT_ROOM_ID を設定してください。');
    return;
  }

  // 行データ取得
  const rowValues = sheet.getRange(row, 1, 1, CONFIG.COL.PUBLISH_CHECK).getValues()[0];

  const dateRaw      = rowValues[CONFIG.COL.DATE - 1];
  const youtubeUrl   = rowValues[CONFIG.COL.YOUTUBE_URL - 1];
  const salonTitle   = rowValues[CONFIG.COL.SALON_TITLE - 1];
  const postPage     = rowValues[CONFIG.COL.POST_PAGE - 1];
  const vimeoUrl     = rowValues[CONFIG.COL.VIMEO_URL - 1];
  const vimeoEmbed   = rowValues[CONFIG.COL.VIMEO_EMBED - 1];

  // 必須項目チェック
  if (!salonTitle || !postPage || !vimeoUrl || !vimeoEmbed) {
    Logger.log('⚠️ 必須データが不足しています（行: ' + row + '）');
    showAlert_('公開報告の自動送信に失敗しました。\nS〜V列のデータが揃っているか確認してください。（行: ' + row + '）');
    return;
  }

  // 日付フォーマット
  const dateInfo = formatDate_(dateRaw);

  // メッセージ生成（TO_ACCOUNT_IDSをプロパティから渡す）
  const message = buildMessage_({
    dateInfo,
    salonTitle,
    postPage,
    youtubeUrl,
    vimeoUrl,
    vimeoEmbed,
    toAccountIds: secrets.TO_ACCOUNT_IDS,
  });

  // Chatwork 送信
  try {
    sendToChatwork_(secrets.CLIENT_ROOM_ID, secrets.CHATWORK_API_TOKEN, message);
    Logger.log('✅ Chatwork送信完了（行: ' + row + ' / ' + salonTitle + '）');
  } catch (err) {
    Logger.log('❌ Chatwork送信エラー: ' + err.toString());
    showAlert_('Chatwork送信でエラーが発生しました。\nログを確認してください。\n\n' + err.toString());
  }
}


// ============================================================
//  日付フォーマット
//  A列がDate型・テキスト（"4/15/水曜日"）どちらでも対応
// ============================================================
function formatDate_(dateRaw) {
  let date;

  if (dateRaw instanceof Date) {
    date = dateRaw;
  } else {
    // テキスト形式のパース（例: "4/15/水曜日" → 年を補完して変換）
    const matched = String(dateRaw).match(/(\d+)\/(\d+)/);
    if (matched) {
      const year = new Date().getFullYear();
      date = new Date(year, parseInt(matched[1]) - 1, parseInt(matched[2]));
    } else {
      date = new Date(dateRaw);
    }
  }

  const month      = date.getMonth() + 1;
  const day        = date.getDate();
  const dayNames   = ['日', '月', '火', '水', '木', '金', '土'];
  const dayOfWeek  = dayNames[date.getDay()];

  return {
    dateJP:    month + '月' + day + '日',       // 例: 4月17日
    dateSlash: month + '/' + day,               // 例: 4/17
    dayOfWeek: dayOfWeek,                        // 例: 金
  };
}


// ============================================================
//  メッセージ生成
//  Chatworkの [info][/info] ブロックで見やすく整形
// ============================================================
function buildMessage_({ dateInfo, salonTitle, postPage, youtubeUrl, vimeoUrl, vimeoEmbed, toAccountIds }) {

  // TO行の生成（複数宛先対応）
  const toLines = (toAccountIds || [])
    .map(function(id) { return '[To:' + id + ']'; })
    .join('\n');

  const message =
    toLines + '\n' +
    'お疲れ様です！\n\n' +
    dateInfo.dateJP + 'のdxd限定動画配信の公開ページを作成しましたのでご連絡します。\n\n' +
    '[info]\n' +
    dateInfo.dateSlash + '（' + dateInfo.dayOfWeek + '） ' + CONFIG.DELIVERY_TIME + ' 配信予約\n' +
    '【DxD限定動画】' + salonTitle + '\n\n' +
    '投稿ページ\n' +
    postPage + '\n\n' +
    'youtube\n' +
    (youtubeUrl || '（未設定）') + '\n\n' +
    'vimeo\n' +
    vimeoUrl + '\n\n' +
    '埋め込みコード\n' +
    vimeoEmbed + '\n' +
    '[/info]';

  return message;
}


// ============================================================
//  Chatwork API 送信
// ============================================================
function sendToChatwork_(roomId, apiToken, message) {
  const url = 'https://api.chatwork.com/v2/rooms/' + roomId + '/messages';

  const options = {
    method: 'POST',
    headers: {
      'X-ChatWorkToken': apiToken,
    },
    payload: {
      body: message,
    },
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(url, options);
  const statusCode = response.getResponseCode();
  const resultText = response.getContentText();

  if (statusCode !== 200) {
    throw new Error('Chatwork API エラー (HTTP ' + statusCode + '): ' + resultText);
  }

  const result = JSON.parse(resultText);
  Logger.log('message_id: ' + result.message_id);
  return result;
}


// ============================================================
//  テスト送信（手動実行用）
//  GASエディタで sendTest() を選択して「実行」ボタンで動作確認できます
// ============================================================
function sendTest() {
  const secrets = getConfig_();

  const message = buildMessage_({
    dateInfo: {
      dateJP:    '4月17日',
      dateSlash: '4/17',
      dayOfWeek: '金',
    },
    salonTitle:   '【テスト】ミスショットをミスにしないラウンド術',
    postPage:     'https://dxdgolf.com/lesson/2026-4-17-test/',
    youtubeUrl:   'https://youtu.be/test_url',
    vimeoUrl:     'https://vimeo.com/000000000',
    vimeoEmbed:   '<div style="padding:56.25% 0 0 0;position:relative;"><iframe src="https://player.vimeo.com/video/000000000" frameborder="0"></iframe></div>',
    toAccountIds: secrets.TO_ACCOUNT_IDS,
  });

  // まずログでメッセージ内容を確認
  Logger.log('=== 送信メッセージプレビュー ===\n' + message);

  // 内容を確認後、実際に送信する場合は下の行のコメントアウトを外す
  sendToChatwork_(secrets.CLIENT_ROOM_ID, secrets.CHATWORK_API_TOKEN, message);
}


// ============================================================
//  ユーティリティ：チャンネルのメンバー一覧とIDを確認する
//  GASエディタで getRoomMembers() を選択して「実行」してください
//  実行ログに「名前 : アカウントID」の一覧が表示されます
// ============================================================
function getRoomMembers() {
  const secrets = getConfig_();
  const url = 'https://api.chatwork.com/v2/rooms/' + secrets.CLIENT_ROOM_ID + '/members';

  const options = {
    method: 'GET',
    headers: {
      'X-ChatWorkToken': secrets.CHATWORK_API_TOKEN,
    },
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(url, options);
  const members = JSON.parse(response.getContentText());

  Logger.log('=== チャンネルメンバー一覧 ===');
  members.forEach(function(member) {
    Logger.log(member.name + ' : ' + member.account_id);
  });
}


// ============================================================
//  ユーティリティ：アラートポップアップ表示
// ============================================================
function showAlert_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    // UIが使えない環境（定期実行など）ではログのみ
    Logger.log('ALERT: ' + message);
  }
}
