// ============================================================
//  動画素材受領フォーム → 動画素材シート 自動転記
//
//  【動作】
//  Googleフォーム送信時に onFormSubmit トリガーが発火し、
//  1素材分のデータを「動画素材」シートに自動転記する。
//
//  【フォームのフィールド構成】（順番通りに作成すること）
//  タイムスタンプ（自動）
//  素材タイトル      （短文テキスト・必須）
//  ギガファイルURL1   （短文テキスト・任意）
//  ギガファイルURL2   （短文テキスト・任意）
//  ギガファイルURL3   （短文テキスト・任意）
//  メモ              （段落テキスト・任意）
//
//  【動画素材シートの列構成】
//  A: 通番（M001〜）
//  B: 受領日時
//  C: 素材タイトル
//  D: URL1
//  E: URL2
//  F: URL3
//  G: メモ
//
// ============================================================


// ============================================================
//  ▼ 設定
//
//  通知先メールアドレスは GAS スクリプトプロパティで管理します。
//
//  【スクリプトプロパティの設定方法】
//  GASエディタ → 左メニュー「プロジェクトの設定（歯車）」
//  →「スクリプト プロパティ」→「プロパティを追加」
//
  //  キー                  値
  //  ──────────────────────────────────────
  //  NOTIFY_EMAIL          （通知を受け取るメールアドレス）
  //  CHATWORK_API_TOKEN    （ChatworkのAPIトークン）
  //  CLIENT_ROOM_ID1       （送信先クライアントルームID）
//
// ============================================================
function getConfig_material_() {
  const props = PropertiesService.getScriptProperties();
  return {
    NOTIFY_EMAIL:       props.getProperty('NOTIFY_EMAIL') || Session.getActiveUser().getEmail(),
    CHATWORK_API_TOKEN: props.getProperty('CHATWORK_API_TOKEN'),
    CLIENT_ROOM_ID:     props.getProperty('CLIENT_ROOM_ID1'),
  };
}


const MATERIAL_CONFIG = {
  MATERIAL_SHEET_NAME: '動画素材',
  SERIAL_PREFIX:       'M',
  SERIAL_DIGITS:       3,
  HEADER_ROWS:         1,

  // フォーム回答列インデックス（0始まり）
  COL: {
    TIMESTAMP: 0,
    TITLE:     1,
    URL1:      2,
    URL2:      3,
    URL3:      4,
    MEMO:      5,
  },
};


// ============================================================
//  メイン：onFormSubmit トリガー
//  ※ GASエディタで「トリガー追加」→ フォーム送信時 → onFormSubmit を設定
// ============================================================
function onFormSubmit(e) {
  const config    = getConfig_material_();
  const responses = e.values;
  const C         = MATERIAL_CONFIG.COL;

  const timestamp = new Date(responses[C.TIMESTAMP]);
  const title     = (responses[C.TITLE] || '').trim();
  const url1      = (responses[C.URL1]  || '').trim();
  const url2      = (responses[C.URL2]  || '').trim();
  const url3      = (responses[C.URL3]  || '').trim();
  const memo      = (responses[C.MEMO]  || '').trim();

  if (!title) {
    Logger.log('⚠️ 素材タイトルが空のため処理をスキップしました');
    return;
  }

  // 動画素材シートに転記
  const sheet  = getOrCreateMaterialSheet_();
  const serial = appendMaterial_(sheet, { timestamp, title, url1, url2, url3, memo });

  Logger.log('✅ 転記完了: ' + serial + ' / ' + title);

  // Gmail 通知
  try {
    sendGmailNotification_(config.NOTIFY_EMAIL, serial, title, url1, url2, url3, memo);
    Logger.log('✅ Gmail通知送信完了: ' + config.NOTIFY_EMAIL);
  } catch (err) {
    Logger.log('❌ Gmail送信エラー: ' + err.toString());
  }

  // Chatwork クライアントルームへのメモ送信
  if (config.CHATWORK_API_TOKEN && config.CLIENT_ROOM_ID) {
    try {
      const cwMessage = buildChatworkMemo_(serial, title, url1, url2, url3, memo);
      sendToChatwork_(config.CLIENT_ROOM_ID, config.CHATWORK_API_TOKEN, cwMessage);
      Logger.log('✅ Chatworkメモ送信完了');
    } catch (err) {
      Logger.log('❌ Chatwork送信エラー: ' + err.toString());
    }
  }
}


// ============================================================
//  動画素材シートに1行転記し、採番した通番を返す
// ============================================================
function appendMaterial_(sheet, { timestamp, title, url1, url2, url3, memo }) {
  const serial = formatSerial_(getNextSerial_(sheet));

  sheet.appendRow([
    serial,     // A: 通番
    timestamp,  // B: 受領日時
    title,      // C: 素材タイトル
    url1,       // D: URL1
    url2,       // E: URL2
    url3,       // F: URL3
    memo,       // G: メモ
  ]);

  return serial;
}


// ============================================================
//  次の通番（数値）を取得
// ============================================================
function getNextSerial_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= MATERIAL_CONFIG.HEADER_ROWS) return 1;

  const lastSerial = sheet.getRange(lastRow, 1).getValue();
  const matched    = String(lastSerial).match(/\d+/);
  return matched ? parseInt(matched[0]) + 1 : 1;
}


// ============================================================
//  通番を文字列にフォーマット（例: 7 → "M007"）
// ============================================================
function formatSerial_(num) {
  return MATERIAL_CONFIG.SERIAL_PREFIX + String(num).padStart(MATERIAL_CONFIG.SERIAL_DIGITS, '0');
}


// ============================================================
//  「動画素材」シートを取得（なければ作成してヘッダーを設定）
// ============================================================
function getOrCreateMaterialSheet_() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let   sheet = ss.getSheetByName(MATERIAL_CONFIG.MATERIAL_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(MATERIAL_CONFIG.MATERIAL_SHEET_NAME);
    sheet.appendRow(['通番', '受領日時', '素材タイトル', 'URL1', 'URL2', 'URL3', 'メモ']);

    const headerRange = sheet.getRange(1, 1, 1, 7);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#d9ead3');

    sheet.setColumnWidth(1, 80);   // 通番
    sheet.setColumnWidth(2, 150);  // 受領日時
    sheet.setColumnWidth(3, 300);  // 素材タイトル
    sheet.setColumnWidths(4, 3, 260); // URL1〜3
    sheet.setColumnWidth(7, 200);  // メモ

    Logger.log('✅ 「動画素材」シートを新規作成しました');
  }

  return sheet;
}


// ============================================================
//  Chatwork クライアントルームへのメモ送信（宛先なし）
// ============================================================
function buildChatworkMemo_(serial, title, url1, url2, url3, memo) {
  const urls = [url1, url2, url3].filter(function(u) { return u !== ''; });
  const urlLines = urls.map(function(url, idx) {
    return '  URL' + (idx + 1) + ': ' + url;
  }).join('\n');

  const memoLine = memo ? '\n\n【メモ】\n' + memo : '';

  return (
    '[info][title]動画素材を受領しました[/title]' +
    serial + ': ' + title + '\n' +
    urlLines +
    memoLine +
    '[/info]'
  );
}


function sendToChatwork_(roomId, apiToken, message) {
  const url = 'https://api.chatwork.com/v2/rooms/' + roomId + '/messages';
  const options = {
    method:             'POST',
    headers:            { 'X-ChatWorkToken': apiToken },
    payload:            { body: message },
    muteHttpExceptions: true,
  };
  const response   = UrlFetchApp.fetch(url, options);
  const statusCode = response.getResponseCode();
  const resultText = response.getContentText();
  if (statusCode !== 200) {
    throw new Error('Chatwork API エラー (HTTP ' + statusCode + '): ' + resultText);
  }
  return JSON.parse(resultText);
}


// ============================================================
//  Gmail 通知送信
// ============================================================
function sendGmailNotification_(toEmail, serial, title, url1, url2, url3, memo) {
  const subject = '【動画素材受領】' + serial + ': ' + title;

  const urls = [url1, url2, url3].filter(function(u) { return u !== ''; });
  const urlLines = urls.map(function(url, idx) {
    return 'URL' + (idx + 1) + ': ' + url;
  }).join('\n');

  const body = [
    '動画素材を受領しました。',
    '',
    '通番: ' + serial,
    'タイトル: ' + title,
    urlLines,
    memo ? '\nメモ:\n' + memo : '',
  ].join('\n');

  GmailApp.sendEmail(toEmail, subject, body);
}


// ============================================================
//  テスト実行（手動確認用）
//  GASエディタで testFormSubmit() を選択して「実行」
// ============================================================
function testFormSubmit() {
  const fakeEvent = {
    values: [
      '2026/04/21 10:00:00',
      '4/16撮影 ユニオンゴルフ アプローチレッスン',
      'https://77.gigafile.nu/test-url-1',
      'https://77.gigafile.nu/test-url-2',
      '',
      '前半・後半に分けて編集希望',
    ],
  };

  Logger.log('=== テスト実行開始 ===');
  onFormSubmit(fakeEvent);
  Logger.log('=== テスト実行完了 ===');
}
