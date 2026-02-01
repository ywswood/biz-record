/**
 * ========================================================================
 * 🟢 議事録＆企画書 自動生成スクリプト（完全版：メール送信付き・変数名重複対応）
 * 🟢 transcription.gs と共存可能
 * ========================================================================
 */

// ==========================================
// 設定 (MINUTES_CONFIG)
// ==========================================
const MINUTES_CONFIG = {
    // API Bank設定
    BANK_URL: 'https://script.google.com/macros/s/AKfycbxCscLkbbvTUU7sqpZSayJ8pEQlWl8mrEBaSy_FklbidJRc649HwWc4SF0Q3GvUQZbuGA/exec',
    BANK_PASS: '1030013',
    PROJECT_NAME: 'biz-record',

    // Google Driveフォルダ
    TXT_FOLDER_ID: '11gbAyd8kdgZN8bD29PDAm32B0LuboVtq', // 読み込み元
    DOC_FOLDER_ID: '1s3X47RZlrgDc3_MZQSgp5v9TvM8EUt_i', // 保存先
    VOICE_FOLDER_ID: '1Drp4_rkJsLpdC49tzRDACcCnQb_ywl4h', // 画像検索用

    // メール通知先
    NOTIFICATION_EMAIL: 'y-inoue@woodstock.co.jp',

    // サンプル画像名
    SAMPLE_IMAGE_NAME: 'sample_product.png',

    // リトライ設定
    MAX_RETRIES: 3,
    RETRY_DELAY: 2000,
    API_TIMEOUT: 300 // 5分
};

// ==========================================
// プロンプト定義 (MINUTES_PROMPTS)
// ==========================================
const MINUTES_PROMPTS = {
    MINUTES: `
以下の会議の書き起こしテキストから、指定のフォーマットで議事録を作成してください。

【重要ルール】
- **冒頭の挨拶（「承知しました」「以下に作成します」等）は一切不要です。**
- 指定された出力フォーマットの中身だけを出力してください。
- 余計な前置きや後書きは書かないでください。

【出力フォーマット】
## 議事録：[会議名称]

### 1. 開催概要
* **日時：** 202X年MM月DD日（曜） HH:mm 〜 HH:mm (推定)
* **出席者：** テキストから推定される人物

### 2. 本日の目的
* [会議の主な目的を1〜2行で]

### 3. 決定事項
> **【決定】** [決定した内容1]
> **【決定】** [決定した内容2]

### 4. 協議内容（要旨）
#### [議題1]
* [内容]
#### [議題2]
* [内容]

### 5. ネクストアクション（ToDo）
| 期限 | タスク内容 | 担当者 |
| --- | --- | --- |
| MM/DD | [タスク1] | [氏名] |

### 6. 次回予定
* [次回の日程や議題など]
`,

    PROPOSAL: `
以下の会議の書き起こしテキストから、この会議で議論されている「新商品」に関する企画書を作成してください。

【重要ルール】
- **冒頭の挨拶は一切不要です。**
- **企画書の中身（見出し以降）のみ**を出力してください。

【出力フォーマット】
# 商品企画書：[商品名]

## 1. 商品コンセプト
[商品の魅力やコンセプトを情熱的に記述]

## 2. ターゲット層
* [ターゲット1]
* [ターゲット2]

## 3. 商品仕様（スペック）
| 項目 | 内容 |
| --- | --- |
| サイズ | [記述] |
| 素材 | [記述] |
| カラー | [記述] |
| 価格 | [記述] |

## 4. セールスポイント
1. **[ポイント1]**: [詳細]
2. **[ポイント2]**: [詳細]
3. **[ポイント3]**: [詳細]

## 5. キャッチコピー案
* 「[案1]」
* 「[案2]」
`
};

// ==========================================
// メイン処理（トリガー実行）
// ==========================================
// ==========================================
// 手動実行用 (待機時間を無視して強制実行)
// ==========================================
function manualRun() {
    processDocuments(true);
}

// ==========================================
// メイン処理（トリガー実行）
// force = true の場合は待機時間を無視
// ==========================================
async function processDocuments(force = false) {
    try {
        Logger.log(`=== 書類生成処理を開始 (Force: ${force}) ===`);

        const txtFolder = DriveApp.getFolderById(MINUTES_CONFIG.TXT_FOLDER_ID);
        const docFolder = DriveApp.getFolderById(MINUTES_CONFIG.DOC_FOLDER_ID);
        const files = txtFolder.getFilesByType(MimeType.PLAIN_TEXT);

        let processedCount = 0;
        const STABILITY_THRESHOLD_MS = 20 * 60 * 1000; // 20分以内の更新は処理しない

        while (files.hasNext()) {
            const file = files.next();
            const fileName = file.getName(); // 例: 260201_150000.txt

            // 連番ファイル(_01) または タイムスタンプ(_162256) の両方を許可
            if (!fileName.match(/^\d{6}_(\d{2}|\d{6})\.txt$/)) continue;

            // 強制実行でない場合のみ、待機判定を行う
            if (!force) {
                const lastUpdated = file.getLastUpdated().getTime();
                const now = Date.now();

                if (now - lastUpdated < STABILITY_THRESHOLD_MS) {
                    Logger.log(`⏳ 待機中（更新直後）: ${fileName}`);
                    continue;
                }
            } else {
                Logger.log(`⚡ 強制実行: ${fileName}（待機時間をスキップします）`);
            }

            const baseName = fileName.replace('.txt', '');

            // 既に議事録があるかチェック
            const minutesName = `【議事録】${baseName}`;
            if (docFolder.getFilesByName(minutesName).hasNext()) {
                continue; // 作成済みならスキップ
            }

            Logger.log(`📄 書類生成ターゲット検出: ${fileName}`);
            const textContent = file.getBlob().getDataAsString();

            let createdFiles = [];

            // 1. 議事録作成
            const minutesContent = await callGeminiForMinutes(textContent, MINUTES_PROMPTS.MINUTES);
            if (minutesContent) {
                const docFile = createMinutesDoc(docFolder, minutesName, minutesContent);
                createdFiles.push(docFile);
                Logger.log(`✅ 議事録作成完了: ${minutesName}`);
            }

            // 2. 企画書作成
            const proposalName = `【企画書】${baseName}`;
            if (!docFolder.getFilesByName(proposalName).hasNext()) {
                const proposalContent = await callGeminiForMinutes(textContent, MINUTES_PROMPTS.PROPOSAL);
                if (proposalContent) {
                    const imageBlob = findSampleImage();
                    const docFile = createMinutesDoc(docFolder, proposalName, proposalContent, imageBlob);
                    createdFiles.push(docFile);
                    Logger.log(`✅ 企画書作成完了: ${proposalName}`);
                }
            }

            // 3. メール送信
            if (createdFiles.length > 0) {
                sendNotificationEmail(baseName, createdFiles);
            }

            processedCount++;
        }

        Logger.log(`=== 処理完了: ${processedCount}件のファイルを処理 ===`);

    } catch (error) {
        Logger.log(`❌ メイン処理エラー: ${error.message}`);
        Logger.log(error.stack);
    }
}

// ==========================================
// Googleドキュメント作成
// ==========================================
function createMinutesDoc(folder, title, content, imageBlob = null) {
    const doc = DocumentApp.create(title);
    const body = doc.getBody();

    body.setText(content);

    // 画像がある場合
    if (imageBlob) {
        try {
            body.insertParagraph(0, "");
            const image = body.insertImage(1, imageBlob);

            // 修正: getHeightを使わず幅のみ指定
            const originalWidth = image.getWidth();
            if (originalWidth > 400) {
                image.setWidth(400);
                // 高さは自動
            }
        } catch (e) {
            Logger.log(`⚠️ 画像挿入中にエラー(スキップしました): ${e.message}`);
        }
    }

    doc.saveAndClose();

    // フォルダ移動とファイル取得
    const docFile = DriveApp.getFileById(doc.getId());
    docFile.moveTo(folder);

    return docFile;
}

// ==========================================
// メール送信
// ==========================================
function sendNotificationEmail(baseName, files) {
    const subject = `【商談書類生成】${baseName}`;
    let body = `商談の自動文字起こしから、以下の書類を生成しました。\n\n`;
    const attachments = [];

    files.forEach(file => {
        body += `・${file.getName()}\n${file.getUrl()}\n`;
        attachments.push(file.getAs(MimeType.PDF));
    });

    body += `\n\n以上のファイルをPDFとして添付しました。ご確認ください。\n`;
    body += `\n--\nBiz-Record Bot`;

    MailApp.sendEmail({
        to: MINUTES_CONFIG.NOTIFICATION_EMAIL,
        subject: subject,
        body: body,
        attachments: attachments
    });

    Logger.log(`📧 メール送信完了: ${MINUTES_CONFIG.NOTIFICATION_EMAIL}`);
}

// ==========================================
// 画像検索
// ==========================================
function findSampleImage() {
    try {
        const foldersToCheck = [MINUTES_CONFIG.VOICE_FOLDER_ID, MINUTES_CONFIG.TXT_FOLDER_ID];

        for (const folderId of foldersToCheck) {
            const folder = DriveApp.getFolderById(folderId);
            const files = folder.getFilesByName(MINUTES_CONFIG.SAMPLE_IMAGE_NAME);
            if (files.hasNext()) {
                return files.next().getBlob();
            }
        }
        return null;
    } catch (e) {
        return null;
    }
}

// ==========================================
// Gemini API 呼び出し
// ==========================================
async function callGeminiForMinutes(text, systemPrompt) {
    let previousModel = null;

    for (let attempt = 1; attempt <= MINUTES_CONFIG.MAX_RETRIES; attempt++) {
        try {
            let bankUrl = `${MINUTES_CONFIG.BANK_URL}?pass=${MINUTES_CONFIG.BANK_PASS}&project=${MINUTES_CONFIG.PROJECT_NAME}`;
            if (previousModel) {
                bankUrl += `&error_503=true&previous_model=${encodeURIComponent(previousModel)}`;
            }

            const bankRes = UrlFetchApp.fetch(bankUrl, { muteHttpExceptions: true });
            const bankData = JSON.parse(bankRes.getContentText());

            if (bankData.status !== 'success') {
                throw new Error(bankData.message);
            }

            const { api_key, model_name } = bankData;
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model_name}:generateContent?key=${api_key}`;

            const payload = {
                contents: [{
                    parts: [{ text: systemPrompt + "\n\n【書き起こしテキスト】\n" + text }]
                }]
            };

            const geminiRes = UrlFetchApp.fetch(apiUrl, {
                method: 'post',
                contentType: 'application/json',
                payload: JSON.stringify(payload),
                muteHttpExceptions: true,
                timeout: MINUTES_CONFIG.API_TIMEOUT
            });

            const statusCode = geminiRes.getResponseCode();

            if (statusCode === 503) {
                previousModel = model_name;
                Utilities.sleep(MINUTES_CONFIG.RETRY_DELAY);
                continue;
            }

            const geminiData = JSON.parse(geminiRes.getContentText());

            if (geminiData.error) {
                throw new Error(JSON.stringify(geminiData.error));
            }

            return geminiData.candidates[0].content.parts[0].text;

        } catch (error) {
            Logger.log(`❌ Gemini呼び出しエラー(試行${attempt}): ${error.message}`);
            if (attempt === MINUTES_CONFIG.MAX_RETRIES) return null;
            Utilities.sleep(MINUTES_CONFIG.RETRY_DELAY);
        }
    }
    return null;
}
