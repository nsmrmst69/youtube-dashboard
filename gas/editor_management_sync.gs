// ============================================================
//  運営スケジュール → 編集者管理 自動同期
//
//  【動作】
//  運営スケジュールの K列（ステータス）または F列（編集者）が変更された時に
//  該当編集者の行を 編集者管理シートに自動反映する。
//
//  ■ 編集者管理に表示されるステータス（SHOW_STATUSES）
//    依頼中 / 編集中 / 確認中 / 先方確認中 / 修正中
//
//  ■ 編集者管理から除外されるステータス
//    素材確認中 / 依頼する → 編集者への仕事がまだ発生していない
//    公開作業 / 済         → 編集者の仕事が完了
//
//  【セットアップ】
//  1. スプレッドシートの「拡張機能」→「Apps Script」
//  2. このファイルを貼り付けて保存
//  3. 初回のみ syncAllEditors() を手動実行して既存データを反映
//
// ============================================================


// ============================================================
//  設定
// ============================================================
const SYNC_CONFIG = {
  SCHEDULE_SHEET:   '運営スケジュール',
  EDITOR_SHEET:     '編集者管理',
  HEADER_ROWS:      2,   // 運営スケジュールのヘッダー行数（3行目からデータ）
  COL_EDITOR:       6,   // F列: 編集者名（運営スケジュール）
  COL_STATUS:       11,  // K列: ステータス（運営スケジュール）
  COL_EDITOR_NAME:  1,   // A列: 表示名（編集者管理）
  COL_MATCH_KEY:    17,  // Q列: 照合キー（編集者管理）← 運営スケジュールF列の値と完全一致する値を入れる
  COL_STATUS_START: 2,   // B列: ステータス表示開始列（編集者管理）
  COL_STATUS_END:   7,   // G列: ステータス表示終了列（編集者管理）

  // 編集者管理に表示するステータス（この一覧にないステータスは表示しない）
  SHOW_STATUSES: ['依頼中', '編集中', '確認中', '先方確認中', '修正中'],
};


// ============================================================
//  onEdit トリガー
//  K列（ステータス）または F列（編集者）の変更を検知して同期する
// ============================================================
function onEdit(e) {
  if (!e) return;

  const sheet = e.source.getActiveSheet();
  if (sheet.getName() !== SYNC_CONFIG.SCHEDULE_SHEET) return;

  const col = e.range.getColumn();
  const row = e.range.getRow();

  if (row <= SYNC_CONFIG.HEADER_ROWS) return;

  // K列（ステータス）変更: 変更行の編集者を同期
  if (col === SYNC_CONFIG.COL_STATUS) {
    const editorName = sheet
      .getRange(row, SYNC_CONFIG.COL_EDITOR)
      .getValue()
      .toString()
      .trim();
    if (editorName && editorName !== '—') {
      syncEditorRow_(e.source, editorName);
    }
    return;
  }

  // F列（編集者名）変更: 旧編集者・新編集者の両方を同期
  if (col === SYNC_CONFIG.COL_EDITOR) {
    const newEditor = (e.value  || '').toString().trim();
    const oldEditor = (e.oldValue || '').toString().trim();
    if (newEditor && newEditor !== '—') syncEditorRow_(e.source, newEditor);
    if (oldEditor && oldEditor !== '—') syncEditorRow_(e.source, oldEditor);
    return;
  }
}


// ============================================================
//  指定編集者の行を編集者管理シートに同期する（内部関数）
// ============================================================
function syncEditorRow_(ss, editorName) {
  const scheduleSheet = ss.getSheetByName(SYNC_CONFIG.SCHEDULE_SHEET);
  const editorSheet   = ss.getSheetByName(SYNC_CONFIG.EDITOR_SHEET);

  if (!scheduleSheet || !editorSheet) {
    Logger.log('シートが見つかりません: ' + SYNC_CONFIG.SCHEDULE_SHEET + ' / ' + SYNC_CONFIG.EDITOR_SHEET);
    return;
  }

  // 運営スケジュールから該当編集者の表示対象ステータスを収集
  const allData  = scheduleSheet.getDataRange().getValues();
  const statuses = [];

  for (let i = SYNC_CONFIG.HEADER_ROWS; i < allData.length; i++) {
    const rowEditor = String(allData[i][SYNC_CONFIG.COL_EDITOR - 1]).trim();
    const rowStatus = String(allData[i][SYNC_CONFIG.COL_STATUS - 1]).trim();

    if (rowEditor !== editorName) continue;
    if (!SYNC_CONFIG.SHOW_STATUSES.includes(rowStatus)) continue;

    statuses.push(rowStatus);
  }

  // 編集者管理シートで該当編集者の行を検索（H列の照合キー優先、なければA列で照合）
  const editorData = editorSheet.getDataRange().getValues();
  let targetRow = -1;

  for (let i = 0; i < editorData.length; i++) {
    const matchKey   = String(editorData[i][SYNC_CONFIG.COL_MATCH_KEY - 1]).trim();
    const displayName = String(editorData[i][SYNC_CONFIG.COL_EDITOR_NAME - 1]).trim();
    if (matchKey === editorName || displayName === editorName) {
      targetRow = i + 1; // 1始まり
      break;
    }
  }

  if (targetRow === -1) {
    Logger.log('編集者が見つかりません（H列に照合キーを登録してください）: ' + editorName);
    return;
  }

  // B〜G列（最大6件）を左詰めで書き込み、余りは「空き」で埋める
  const maxCols   = SYNC_CONFIG.COL_STATUS_END - SYNC_CONFIG.COL_STATUS_START + 1;
  const newValues = [];
  for (let c = 0; c < maxCols; c++) {
    newValues.push(c < statuses.length ? statuses[c] : '空き');
  }

  editorSheet
    .getRange(targetRow, SYNC_CONFIG.COL_STATUS_START, 1, maxCols)
    .setValues([newValues]);

  Logger.log('✅ 編集者管理 更新: ' + editorName + ' → [' + statuses.join(', ') + ']');
}


// ============================================================
//  デバッグ用: 実際のデータを確認する（手動実行用）
//  実行後、Apps Script の「ログ」ボタンでログを確認してください。
// ============================================================
function debugCheckData() {
  const ss            = SpreadsheetApp.getActiveSpreadsheet();
  const scheduleSheet = ss.getSheetByName(SYNC_CONFIG.SCHEDULE_SHEET);
  const editorSheet   = ss.getSheetByName(SYNC_CONFIG.EDITOR_SHEET);

  Logger.log('=== シート確認 ===');
  Logger.log('運営スケジュール: ' + (scheduleSheet ? '✅ 見つかった' : '❌ 見つからない'));
  Logger.log('編集者管理: '       + (editorSheet   ? '✅ 見つかった' : '❌ 見つからない'));

  if (!scheduleSheet || !editorSheet) return;

  // 運営スケジュール: データ行のF列・K列の値を確認
  Logger.log('\n=== 運営スケジュール（F列:編集者 / K列:ステータス）===');
  const scheduleData = scheduleSheet.getDataRange().getValues();
  Logger.log('総行数: ' + scheduleData.length + '行（ヘッダー含む）');
  for (let i = SYNC_CONFIG.HEADER_ROWS; i < scheduleData.length; i++) {
    const editor = String(scheduleData[i][SYNC_CONFIG.COL_EDITOR - 1]).trim();
    const status = String(scheduleData[i][SYNC_CONFIG.COL_STATUS - 1]).trim();
    if (!editor && !status) continue;
    const matched = SYNC_CONFIG.SHOW_STATUSES.includes(status);
    Logger.log('行' + (i + 1) + ': 編集者=[' + editor + '] ステータス=[' + status + '] ' + (matched ? '✅表示対象' : '⬜対象外'));
  }

  // 編集者管理: A列の編集者名を確認
  Logger.log('\n=== 編集者管理（A列:編集者名）===');
  const editorData = editorSheet.getDataRange().getValues();
  Logger.log('総行数: ' + editorData.length + '行');
  for (let i = 0; i < editorData.length; i++) {
    const name = String(editorData[i][SYNC_CONFIG.COL_EDITOR_NAME - 1]).trim();
    Logger.log('行' + (i + 1) + ': [' + name + ']');
  }

  Logger.log('\n=== SHOW_STATUSES（表示対象ステータス）===');
  Logger.log(SYNC_CONFIG.SHOW_STATUSES.join(' / '));
}


// ============================================================
//  全編集者を一括再同期（手動実行用）
//  初回セットアップ時や手動リフレッシュしたいときに実行してください。
// ============================================================
function syncAllEditors() {
  const ss          = SpreadsheetApp.getActiveSpreadsheet();
  const editorSheet = ss.getSheetByName(SYNC_CONFIG.EDITOR_SHEET);

  if (!editorSheet) {
    SpreadsheetApp.getUi().alert('「' + SYNC_CONFIG.EDITOR_SHEET + '」シートが見つかりません。');
    return;
  }

  const editorData = editorSheet.getDataRange().getValues();
  let count = 0;

  for (let i = 0; i < editorData.length; i++) {
    const name = String(editorData[i][SYNC_CONFIG.COL_EDITOR_NAME - 1]).trim();
    // Q列（照合キー）が空の行はスキップ
    const matchKey = String(editorData[i][SYNC_CONFIG.COL_MATCH_KEY - 1]).trim();
    if (!matchKey) continue;
    const keyForSync = matchKey;
    syncEditorRow_(ss, keyForSync);
    count++;
  }

  SpreadsheetApp.getUi().alert(count + '名の編集者データを再同期しました。');
}
