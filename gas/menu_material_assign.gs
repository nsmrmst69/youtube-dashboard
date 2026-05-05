// ============================================================
//  動画素材シート → 運営スケジュール 転記メニュー
//
//  【動作】
//  スプレッドシート上部のカスタムメニューから素材を選択し、
//  運営スケジュールの選択行の D列 に転記する。
//  素材タイトルをセル値、ギガファイルURL・メモをセルのメモとして書き込む。
//
//  【使い方】
//  ① 運営スケジュールで転記したい日付行のセルをクリック
//  ② メニュー「動画素材」→「素材を転記」
//  ③ ダイアログで素材を選択して「転記」ボタンをクリック
//
// ============================================================


// ============================================================
//  スプレッドシート起動時にカスタムメニューを追加
//  ※ この関数は手動トリガー不要（onOpen は特殊トリガー）
// ============================================================
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('動画素材')
    .addItem('素材を転記', 'showMaterialDialog')
    .addSeparator()
    .addItem('転記済みをリセット（選択行）', 'resetTransferredMark')
    .addToUi();
  ui.createMenu('編集依頼')
    .addItem('依頼文を生成（選択行）', 'generateRequestMessage')
    .addToUi();
}


// ============================================================
//  素材選択ダイアログを表示
// ============================================================
function showMaterialDialog() {
  const ui       = SpreadsheetApp.getUi();
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const schedule = ss.getSheetByName(ASSIGN_CONFIG.SCHEDULE_SHEET_NAME);

  if (!schedule) {
    ui.alert('エラー', '「' + ASSIGN_CONFIG.SCHEDULE_SHEET_NAME + '」シートが見つかりません。', ui.ButtonSet.OK);
    return;
  }

  // 選択中の行を取得
  const activeRow = ss.getActiveRange().getRow();
  if (activeRow <= ASSIGN_CONFIG.HEADER_ROWS) {
    ui.alert('注意', 'データ行（' + (ASSIGN_CONFIG.HEADER_ROWS + 1) + '行目以降）を選択してください。', ui.ButtonSet.OK);
    return;
  }

  // 既に D列 に値がある場合は確認
  const currentTitle = schedule.getRange(activeRow, ASSIGN_CONFIG.COL_TITLE).getValue();
  if (currentTitle) {
    const confirm = ui.alert(
      '確認',
      activeRow + '行目の D列 には既に「' + currentTitle + '」が入力されています。\n上書きしますか？',
      ui.ButtonSet.YES_NO
    );
    if (confirm !== ui.Button.YES) return;
  }

  // 未転記の素材一覧を取得
  const materials = getUnassignedMaterials_();
  if (materials.length === 0) {
    ui.alert('情報', '転記可能な素材がありません。\n（全素材が転記済みです）', ui.ButtonSet.OK);
    return;
  }

  // HTML ダイアログを表示
  const html = buildDialogHtml_(materials, activeRow);
  const dialog = HtmlService.createHtmlOutput(html)
    .setWidth(520)
    .setHeight(400);
  ui.showModalDialog(dialog, '素材を選択して転記 → ' + activeRow + '行目');
}


// ============================================================
//  素材を転記する（ダイアログの「転記」ボタンから呼び出し）
// ============================================================
function assignMaterial(materialIndex, targetRow) {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const schedule = ss.getSheetByName(ASSIGN_CONFIG.SCHEDULE_SHEET_NAME);
  const material = getUnassignedMaterials_()[materialIndex];

  if (!material || !schedule) return { success: false, message: 'データ取得エラー' };

  // D列にタイトルを書き込む
  const titleCell = schedule.getRange(targetRow, ASSIGN_CONFIG.COL_TITLE);
  titleCell.setValue(material.title);

  // D列のセルメモに URL・メモを書き込む
  const noteLines = [];
  if (material.url1) noteLines.push('URL1: ' + material.url1);
  if (material.url2) noteLines.push('URL2: ' + material.url2);
  if (material.url3) noteLines.push('URL3: ' + material.url3);
  if (material.memo) noteLines.push('メモ: ' + material.memo);

  if (noteLines.length > 0) {
    titleCell.setNote(noteLines.join('\n'));
  }

  // 動画素材シートに転記済みマークをつける
  const materialSheet = ss.getSheetByName(ASSIGN_CONFIG.MATERIAL_SHEET_NAME);
  if (materialSheet) {
    materialSheet.getRange(material.sheetRow, ASSIGN_CONFIG.COL_TRANSFERRED).setValue('✓');
  }

  Logger.log('✅ 転記完了: ' + material.serial + ' → 運営スケジュール ' + targetRow + '行目');
  return { success: true, message: material.serial + '「' + material.title + '」を転記しました。' };
}


// ============================================================
//  転記済みマークをリセット（選択行のD列を空にして転記済みを解除）
// ============================================================
function resetTransferredMark() {
  const ui       = SpreadsheetApp.getUi();
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const schedule = ss.getSheetByName(ASSIGN_CONFIG.SCHEDULE_SHEET_NAME);
  const activeRow = ss.getActiveRange().getRow();

  if (activeRow <= ASSIGN_CONFIG.HEADER_ROWS) return;

  const titleCell  = schedule.getRange(activeRow, ASSIGN_CONFIG.COL_TITLE);
  const currentTitle = titleCell.getValue();
  if (!currentTitle) {
    ui.alert('D列が空欄のため、リセット対象がありません。');
    return;
  }

  const confirm = ui.alert(
    '確認',
    activeRow + '行目の D列「' + currentTitle + '」を削除し、転記済みマークを解除しますか？',
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  // 動画素材シートの転記済みマークを解除
  const materialSheet = ss.getSheetByName(ASSIGN_CONFIG.MATERIAL_SHEET_NAME);
  if (materialSheet) {
    const data = materialSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][ASSIGN_CONFIG.COL_MATERIAL_TITLE - 1] === currentTitle) {
        materialSheet.getRange(i + 1, ASSIGN_CONFIG.COL_TRANSFERRED).setValue('');
        break;
      }
    }
  }

  // D列をクリア
  titleCell.clearContent();
  titleCell.clearNote();

  ui.alert('リセット完了', activeRow + '行目の転記を取り消しました。', ui.ButtonSet.OK);
}


// ============================================================
//  動画素材シートから未転記の素材一覧を取得
// ============================================================
function getUnassignedMaterials_() {
  const ss            = SpreadsheetApp.getActiveSpreadsheet();
  const materialSheet = ss.getSheetByName(ASSIGN_CONFIG.MATERIAL_SHEET_NAME);
  if (!materialSheet) return [];

  const data      = materialSheet.getDataRange().getValues();
  const materials = [];

  for (let i = 1; i < data.length; i++) {
    const row        = data[i];
    const serial     = String(row[0]).trim();
    const title      = String(row[2]).trim();
    const transferred = String(row[ASSIGN_CONFIG.COL_TRANSFERRED - 1]).trim();

    if (!title || transferred === '✓') continue;

    materials.push({
      index:    materials.length,
      sheetRow: i + 1,
      serial:   serial,
      title:    title,
      url1:     String(row[3]).trim(),
      url2:     String(row[4]).trim(),
      url3:     String(row[5]).trim(),
      memo:     String(row[6]).trim(),
    });
  }

  return materials;
}


// ============================================================
//  素材選択ダイアログの HTML を生成
// ============================================================
function buildDialogHtml_(materials, targetRow) {
  const rows = materials.map(function(m) {
    const urlCount = [m.url1, m.url2, m.url3].filter(function(u) { return u !== ''; }).length;
    const urlLabel = urlCount > 0 ? '（URL ' + urlCount + '個）' : '';
    const memoLabel = m.memo ? '　📝' : '';
    return (
      '<label style="display:block;padding:8px 6px;border-bottom:1px solid #eee;cursor:pointer;">' +
      '<input type="radio" name="material" value="' + m.index + '" style="margin-right:8px;">' +
      '<strong>' + escapeHtml_(m.serial) + '</strong>　' +
      escapeHtml_(m.title) +
      '<span style="color:#888;font-size:12px;">　' + urlLabel + memoLabel + '</span>' +
      '</label>'
    );
  }).join('');

  return '<!DOCTYPE html><html><head>' +
    '<style>' +
    'body{font-family:sans-serif;font-size:14px;margin:0;padding:12px;}' +
    '#list{max-height:280px;overflow-y:auto;border:1px solid #ddd;border-radius:4px;margin-bottom:12px;}' +
    'label:hover{background:#f0f7ff;}' +
    'button{padding:8px 24px;font-size:14px;cursor:pointer;border:none;border-radius:4px;}' +
    '#btnOk{background:#4285f4;color:#fff;margin-right:8px;}' +
    '#btnOk:disabled{background:#ccc;}' +
    '#btnCancel{background:#eee;}' +
    '#msg{margin-top:10px;color:#333;}' +
    '</style></head><body>' +
    '<div id="list">' + rows + '</div>' +
    '<button id="btnOk" disabled onclick="doAssign()">転記</button>' +
    '<button id="btnCancel" onclick="google.script.host.close()">キャンセル</button>' +
    '<div id="msg"></div>' +
    '<script>' +
    'document.querySelectorAll("input[name=material]").forEach(function(r){' +
    '  r.addEventListener("change",function(){document.getElementById("btnOk").disabled=false;});' +
    '});' +
    'function doAssign(){' +
    '  var sel=document.querySelector("input[name=material]:checked");' +
    '  if(!sel)return;' +
    '  document.getElementById("btnOk").disabled=true;' +
    '  document.getElementById("msg").textContent="転記中...";' +
    '  google.script.run' +
    '    .withSuccessHandler(function(res){' +
    '      document.getElementById("msg").textContent=res.message;' +
    '      setTimeout(function(){google.script.host.close();},1200);' +
    '    })' +
    '    .withFailureHandler(function(e){' +
    '      document.getElementById("msg").textContent="エラー: "+e.message;' +
    '      document.getElementById("btnOk").disabled=false;' +
    '    })' +
    '    .assignMaterial(parseInt(sel.value),' + targetRow + ');' +
    '}' +
    '</script></body></html>';
}


// ============================================================
//  HTML エスケープ
// ============================================================
function escapeHtml_(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


// ============================================================
//  ▼ 設定
// ============================================================
const ASSIGN_CONFIG = {
  SCHEDULE_SHEET_NAME: '運営スケジュール',
  MATERIAL_SHEET_NAME: '動画素材',
  HEADER_ROWS:         2,    // 運営スケジュールのヘッダー行数
  COL_TITLE:           4,    // D列: 素材タイトル（運営スケジュール）
  COL_TRANSFERRED:     8,    // H列: 転記済みフラグ（動画素材シート）
  COL_MATERIAL_TITLE:  3,    // C列: 素材タイトル（動画素材シート）
};
// ▲ 設定ここまで
// ============================================================
