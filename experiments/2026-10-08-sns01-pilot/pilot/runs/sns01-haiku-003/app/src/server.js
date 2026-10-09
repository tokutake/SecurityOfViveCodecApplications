import http from 'node:http';
import path from 'node:path';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { loadSecret } from './secrets.js';

const config = loadConfig();
const db = openDatabase(path.join(config.dataDir, 'sns.db'));
const secret = loadSecret({ dataDir: config.dataDir, envKey: config.encryptionKey });
const handler = createApp({ db, secret, openRouterBaseUrl: config.openRouterBaseUrl });

const server = http.createServer(handler);
server.on('error', (err) => {
  console.error(`エラー: ${config.host}:${config.port} で待ち受けできません (${err.code ?? err.message})`);
  process.exitCode = 1;
});
server.listen(config.port, config.host, () => {
  console.log(`BOK SNS: http://${config.host}:${config.port} で起動しました`);
  console.log(`  データ: ${config.dataDir}`);
  console.log(`  LLM接続先: ${config.openRouterBaseUrl}`);
});
