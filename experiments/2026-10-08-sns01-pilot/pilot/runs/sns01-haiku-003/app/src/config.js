import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));

// サーバーの環境設定。値は環境変数で上書きできる。
export function loadConfig(env = process.env) {
  return {
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 3000),
    dataDir: env.SNS_DATA_DIR ? path.resolve(env.SNS_DATA_DIR) : path.join(ROOT_DIR, 'data'),
    openRouterBaseUrl: env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    encryptionKey: env.SNS_ENCRYPTION_KEY,
  };
}
