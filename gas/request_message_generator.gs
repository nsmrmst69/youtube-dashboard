// ============================================================
//  編集依頼文 自動生成
//
//  【動作】
//  運営スケジュールシートで行を選択した状態でメニューから実行すると、
//  該当行の情報をもとに外注編集者への依頼文（定型文）を生成し、
//  ダイアログ上でクリップボードにコピーできる。
//
//  【使い方】
//  ① 運営スケジュールシートで依頼したい動画の行（A列など）を選択
//  ② メニュー「編集依頼」→「依頼文を生成（選択行）」
//  ③ ダイアログで内容を確認し「コピー」ボタンを押す
//  ④ Chatwork に貼り付け
//
//  【使用するデータ】
//  D列: 動画タイトル（セルの値）
//  D列のメモ: ギガファイルURL（http〜の行）と備考（それ以外の行）を自動分離
//  I列: 希望納期（納品予定日）
//
// ============================================================


const REQUEST_CONFIG = {
  SCHEDULE_SHEET_NAME: '運営スケジュール',
  HEADER_ROWS:         2,   // 3行目からデータ
  COL_TITLE:           4,   // D列: 動画タイトル
  COL_DELIVERY:        9,   // I列: 納品予定日
};


// ============================================================
//  メイン：依頼文生成（メニューから呼び出し）
// ============================================================
function generateRequestMessage() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const ui    = SpreadsheetApp.getUi();

  if (sheet.getName() !== REQUEST_CONFIG.SCHEDULE_SHEET_NAME) {
    ui.alert('エラー', '「運営スケジュール」シートで実行してください。', ui.ButtonSet.OK);
    return;
  }

  const row = ss.getActiveRange().getRow();
  if (row <= REQUEST_CONFIG.HEADER_ROWS) {
    ui.alert('注意', 'データ行（3行目以降）を選択してください。', ui.ButtonSet.OK);
    return;
  }

  // D列: タイトルとメモを取得
  const titleCell = sheet.getRange(row, REQUEST_CONFIG.COL_TITLE);
  const title     = titleCell.getValue().toString().trim();
  const memo      = titleCell.getNote().trim();

  // I列: 納品予定日を取得
  const deliveryRaw  = sheet.getRange(row, REQUEST_CONFIG.COL_DELIVERY).getValue();
  const deliveryText = formatDelivery_(deliveryRaw);

  if (!title) {
    ui.alert('注意', 'D列にタイトルが入力されていません。', ui.ButtonSet.OK);
    return;
  }

  // メモからギガファイルURLと備考を分離
  const { urls, notes } = parseMemo_(memo);

  // 定型文を生成
  const message = buildRequestMessage_(title, urls, deliveryText, notes);

  // ダイアログ表示
  showCopyDialog_(message);
}


// ============================================================
//  定型文を組み立てる
// ============================================================
function buildRequestMessage_(title, urls, delivery, notes) {
  const urlText  = urls.length  > 0 ? urls.join('\n')  : '（URLなし）';
  const noteText = notes.length > 0 ? notes.join('\n') : '';

  const lines = [
    'お世話になっております。',
    '',
    '次の編集をご依頼させていただきたいです！',
    'スケジュールのご確認お願いいたします(bow)',
    '',
    '[info]',
    '●タイトル',
    title,
    '',
    '●素材',
    urlText,
    '',
    '●希望納期',
    '\u3000' + delivery,
    '',
    '●納品方法',
    'プロマネ（元映像素材なし）で納品お願いします',
    '',
    '●備考',
    noteText,
    '',
    '●DxD限定公開',
    '',
    '',
    '',
    '',
    '',
    '',
    '[/info]',
    'よろしくお願いいたします(bow)',
  ];

  return lines.join('\n');
}


// ============================================================
//  D列のメモをURLと備考に分離する
// ============================================================
function parseMemo_(memo) {
  if (!memo) return { urls: [], notes: [] };

  const urls  = [];
  const notes = [];

  memo.split('\n').forEach(function(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.match(/^https?:\/\//)) {
      urls.push(trimmed);
    } else {
      notes.push(trimmed);
    }
  });

  return { urls: urls, notes: notes };
}


// ============================================================
//  納品予定日を文字列にフォーマット
// ============================================================
function formatDelivery_(raw) {
  if (!raw) return '（未定）';
  if (raw instanceof Date) {
    const days  = ['日', '月', '火', '水', '木', '金', '土'];
    const month = raw.getMonth() + 1;
    const day   = raw.getDate();
    const dow   = days[raw.getDay()];
    return month + '/' + day + '/' + dow;
  }
  return raw.toString().trim();
}


// ============================================================
//  生成した依頼文をダイアログで表示し、コピーボタンを提供
// ============================================================
function showCopyDialog_(message) {
  const escaped = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const html = '<!DOCTYPE html><html><head>' +
    '<style>' +
    'body{font-family:sans-serif;font-size:13px;margin:12px;}' +
    'p{margin:0 0 8px;}' +
    'textarea{width:100%;height:340px;font-size:12px;font-family:monospace;resize:vertical;box-sizing:border-box;padding:8px;}' +
    'button{padding:8px 24px;font-size:14px;cursor:pointer;border:none;border-radius:4px;}' +
    '#btnCopy{background:#4285f4;color:#fff;}' +
    '#btnCopy:active{background:#2a6dd9;}' +
    '#msg{margin-left:12px;color:green;font-size:13px;vertical-align:middle;}' +
    '</style></head><body>' +
    '<p>内容を確認し、「コピー」してChatworkに貼り付けてください。</p>' +
    '<textarea id="txt">' + escaped + '</textarea><br><br>' +
    '<button id="btnCopy" onclick="copyText()">クリップボードにコピー</button>' +
    '<span id="msg"></span>' +
    '<script>' +
    'function copyText(){' +
    '  var t=document.getElementById("txt");' +
    '  t.select();' +
    '  document.execCommand("copy");' +
    '  document.getElementById("msg").textContent="✅ コピーしました！";' +
    '}' +
    'document.getElementById("txt").select();' +
    '</script>' +
    '</body></html>';

  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(580).setHeight(500),
    '編集依頼文を生成しました'
  );
}
