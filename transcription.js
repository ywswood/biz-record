/**
 * ========================================================================
 * 🟢 GAS用コード (transcription.js) - 追記集約版
 * ========================================================================
 */

// ==========================================
// 設定
// ==========================================
const CONFIG = {
  // API Bank設定
  BANK_URL: 'https://script.google.com/macros/s/AKfycbxCscLkbbvTUU7sqpZSayJ8pEQlWl8mrEBaSy_FklbidJRc649HwWc4SF0Q3GvUQZbuGA/exec',
  BANK_PASS: '1030013',
  PROJECT_NAME: 'biz-record',

  // Google Driveフォルダ (重要: txtフォルダIDを確認のこと)
  VOICE_FOLDER_ID: '1Drp4_rkJsLpdC49tzRDACcCnQb_ywl4h', // 音声受け

  // テキスト保存先（旧docフォルダ。今はTXTフォルダとして扱う）
  TXT_FOLDER_ID: '11gbAyd8kdgZN8bD29PDAm32B0LuboVtq',

  // リトライ設定
  MAX_RETRIES: 3,
  RETRY_DELAY: 2000,
  API_TIMEOUT: 300 // 5分
};

// ==========================================
// メイン処理（トリガー実行: 1分ごと）
// ==========================================
function processVoiceFiles() {
  const voiceFolder = DriveApp.getFolderById(CONFIG.VOICE_FOLDER_ID);
  const files = voiceFolder.getFiles();

  Logger.log('=== 処理開始: 音声ファイルスキャン ===');
  let count = 0;

  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();

    // 処理対象: .webmのみ
    if (fileName.endsWith('.webm')) {
      try {
        Logger.log(`🎤 処理開始: ${fileName}`);

        // 文字起こし実行
        const text = transcribeAudio(file);

        if (text) {
          // テキスト保存（追記モード）
          saveTextToSessionFile(fileName, text);

          // 元ファイル削除
          file.setTrashed(true);
          Logger.log(`🗑️ 元ファイル削除: ${fileName}`);
          count++;
        }
      } catch (e) {
        Logger.log(`❌ エラー (${fileName}): ${e.message}`);
      }
    }
  }

  Logger.log(`=== 処理完了: ${count}件 ===`);
}

// ==========================================
// 文字起こし関数
// ==========================================
function transcribeAudio(file) {
  const blob = file.getBlob();
  // ... (ここは既存ロジックと同じ、api_bank呼び出し)
  // 長くなるので既存のtranscribeAudio関数の内容をここに想定
  // 下記の既存実装をそのまま利用するために、ここでは簡略化せずフルのコードが必要
  // しかし、今回の変更点は「保存ロジック」だけなので、transcribeAudioはそのまま流用可能

  // ※実際のGASへコピペする際は、元のtranscribeAudio関数を含めてください
  return callApiBankTranscription(blob, file.getMimeType());
}

// 実際のAPI呼び出し部分（元のコードから抽出・整理）
function callApiBankTranscription(blob, mimeType) {
  let previousModel = null;

  for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try {
      // APIキー取得
      let bankUrl = `${CONFIG.BANK_URL}?pass=${CONFIG.BANK_PASS}&project=${CONFIG.PROJECT_NAME}&type=stt`;
      if (previousModel) {
        bankUrl += `&error_503=true&previous_model=${encodeURIComponent(previousModel)}`;
      }

      const bankRes = UrlFetchApp.fetch(bankUrl, { muteHttpExceptions: true });
      const bankData = JSON.parse(bankRes.getContentText());

      if (bankData.status !== 'success') {
        reportError('INITIAL_FETCH_FAILED');
        throw new Error(bankData.message);
      }

      const { api_key, model_name } = bankData;

      // Gemini呼び出し
      const base64Audio = Utilities.base64Encode(blob.getBytes());
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model_name}:generateContent?key=${api_key}`;

      const payload = {
        contents: [{
          parts: [
            { text: "音声を書き起こしてください。フィラー（えー、あー）は取り除いてください。" },
            { inline_data: { mime_type: mimeType, data: base64Audio } }
          ]
        }]
      };

      const geminiRes = UrlFetchApp.fetch(apiUrl, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
        timeout: CONFIG.API_TIMEOUT
      });

      const statusCode = geminiRes.getResponseCode();

      if (statusCode === 503) {
        previousModel = model_name;
        Utilities.sleep(CONFIG.RETRY_DELAY);
        continue;
      }

      const geminiData = JSON.parse(geminiRes.getContentText());
      if (geminiData.error) {
        reportError(api_key);
        throw new Error(JSON.stringify(geminiData.error));
      }

      return geminiData.candidates[0].content.parts[0].text;

    } catch (error) {
      Logger.log(`❌ リトライ待機: ${error.message}`);
      if (attempt === CONFIG.MAX_RETRIES) throw error;
      Utilities.sleep(CONFIG.RETRY_DELAY);
    }
  }
}

// ==========================================
// [変更点] セッションファイルへの保存（追記）
// ==========================================
function saveTextToSessionFile(originalFileName, text) {
  const txtFolder = DriveApp.getFolderById(CONFIG.TXT_FOLDER_ID);

  // ファイル名からセッションIDを抽出 (YYMMDD_HHmmss_chunkXX.webm -> YYMMDD_HHmmss)
  // ※もしユーザーが 260201_01_01 のような形式を使った場合にも対応するため、
  // 「最後の_chunkXX」を取り除くロジックにする

  // 正規表現: 末尾の _chunkXX.webm を取り除く
  const sessionIdMatch = originalFileName.match(/^(.*)_chunk\d{2}\.webm$/);

  let sessionId = originalFileName.replace('.webm', ''); // デフォルト
  if (sessionIdMatch) {
    sessionId = sessionIdMatch[1]; // これがセッションID (例: 260201_150000 または 260201_01)
  }

  const sessionFileName = `${sessionId}.txt`;

  // チャンク番号取得
  const chunkMatch = originalFileName.match(/_chunk(\d{2})\.webm$/);
  const chunkNum = chunkMatch ? chunkMatch[1] : '00';

  const appendContent = `\n\n--- Chunk ${chunkNum} (${new Date().toLocaleTimeString()}) ---\n${text}`;

  // 既存ファイルを探す
  const existingFiles = txtFolder.getFilesByName(sessionFileName);

  if (existingFiles.hasNext()) {
    // 追記
    const file = existingFiles.next();
    const currentContent = file.getBlob().getDataAsString();
    file.setContent(currentContent + appendContent);
    Logger.log(`📝 既存ファイルに追記: ${sessionFileName}`);
  } else {
    // 新規作成
    const header = `=== 商談記録 ===\nSession ID: ${sessionId}\n作成開始: ${new Date().toLocaleString()}\n`;
    txtFolder.createFile(sessionFileName, header + appendContent, MimeType.PLAIN_TEXT);
    Logger.log(`🆕 新規セッションファイル作成: ${sessionFileName}`);
  }
}

// ==========================================
// エラー報告
// ==========================================
function reportError(api_key) {
  try {
    UrlFetchApp.fetch(CONFIG.BANK_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ pass: CONFIG.BANK_PASS, api_key: api_key }),
      muteHttpExceptions: true
    });
  } catch (e) { }
}