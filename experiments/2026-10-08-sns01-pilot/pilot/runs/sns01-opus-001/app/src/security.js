'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR } = require('./db');

// ---- パスワード (scrypt) ----
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

// タイミング差でユーザー存在を推測されにくくするためのダミーハッシュ
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

// ---- APIキー暗号化 (AES-256-GCM) ----
// 鍵は環境変数 APP_SECRET (32バイト以上の任意文字列) か、データディレクトリ内に自動生成するファイルから得る。
function loadMasterKey() {
  if (process.env.APP_SECRET) {
    return crypto.createHash('sha256').update(process.env.APP_SECRET).digest();
  }
  const keyPath = path.join(DATA_DIR, 'secret.key');
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(keyPath)) {
    fs.writeFileSync(keyPath, crypto.randomBytes(32).toString('base64'), { mode: 0o600, flag: 'wx' });
  }
  const key = Buffer.from(fs.readFileSync(keyPath, 'utf8').trim(), 'base64');
  if (key.length !== 32) throw new Error(`invalid master key: ${keyPath}`);
  return key;
}

let masterKey = null;
function getMasterKey() {
  if (!masterKey) masterKey = loadMasterKey();
  return masterKey;
}

function encryptSecret(plaintext, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getMasterKey(), iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ciphertext };
}

function decryptSecret({ iv, tag, ciphertext }, aad) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', getMasterKey(), Buffer.from(iv));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]).toString('utf8');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

module.exports = {
  hashPassword, verifyPassword, DUMMY_HASH,
  encryptSecret, decryptSecret, getMasterKey,
  randomToken, sha256, safeEqual,
};
