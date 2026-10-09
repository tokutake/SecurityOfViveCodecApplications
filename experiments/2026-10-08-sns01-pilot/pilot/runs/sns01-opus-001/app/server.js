'use strict';
const { openDb, DATA_DIR } = require('./src/db');
const { createApp } = require('./src/app');
const { getMasterKey } = require('./src/security');
const { createMockServer } = require('./src/mock-openrouter');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

async function main() {
  const db = openDb();
  getMasterKey(); // 起動時に暗号鍵を用意しておく

  // OPENROUTER_BASE_URL 未指定時は同一プロセスで模擬APIを起動して接続先にする
  let llmBaseUrl = process.env.OPENROUTER_BASE_URL;
  if (!llmBaseUrl) {
    const mockPort = Number(process.env.MOCK_PORT || 4010);
    await new Promise((resolve, reject) => {
      const mock = createMockServer();
      mock.once('error', reject);
      mock.listen(mockPort, '127.0.0.1', resolve);
    });
    llmBaseUrl = `http://127.0.0.1:${mockPort}/api/v1`;
    console.log(`模擬OpenRouter API を起動しました: ${llmBaseUrl}  (記録確認: GET http://127.0.0.1:${mockPort}/__mock/calls)`);
  }

  const app = createApp({ db, llmBaseUrl, secureCookie: process.env.COOKIE_SECURE === '1' });
  app.listen(PORT, HOST, () => {
    console.log(`SNS-01 起動: http://${HOST}:${PORT}/`);
    console.log(`データ: ${DATA_DIR}`);
    console.log(`LLM接続先: ${llmBaseUrl}/chat/completions`);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
