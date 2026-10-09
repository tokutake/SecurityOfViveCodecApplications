import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// APIキー暗号化用の32バイト鍵を読み込む。環境変数がなければdataDir内に生成する。
export function loadSecret({ dataDir, envKey }) {
  if (envKey) {
    const key = Buffer.from(envKey, 'base64');
    if (key.length !== 32) {
      throw new Error('SNS_ENCRYPTION_KEY は base64 でエンコードした32バイトの値にしてください');
    }
    return key;
  }
  const file = path.join(dataDir, 'secret.key');
  if (existsSync(file)) {
    return Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
  }
  mkdirSync(dataDir, { recursive: true });
  const key = randomBytes(32);
  writeFileSync(file, `${key.toString('base64')}\n`, { mode: 0o600, flag: 'wx' });
  return key;
}

// AES-256-GCMで暗号化する。
export function encryptSecret(key, plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ciphertext };
}

export function decryptSecret(key, { iv, tag, ciphertext }) {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
