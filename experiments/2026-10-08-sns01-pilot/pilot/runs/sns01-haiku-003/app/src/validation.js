import { HttpError } from './http.js';

export const MODELS = Object.freeze(['test/model-a', 'test/model-b']);
export const MAX_POST_LENGTH = 140;
const MAX_DISPLAY_NAME_LENGTH = 30;
const MAX_INSTRUCTION_LENGTH = 500;
const MAX_API_KEY_LENGTH = 300;

const bad = (message) => new HttpError(400, message);

// 文字数はUnicodeコードポイント数で数える。
export function codePointLength(text) {
  return [...text].length;
}

export function truncateCodePoints(text, max) {
  return [...text].slice(0, max).join('');
}

export function parseUsername(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_]{3,20}$/.test(value)) {
    throw bad('ユーザー名は英数字と_の3〜20文字で入力してください');
  }
  return value;
}

export function parsePassword(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 200) {
    throw bad('パスワードは8〜200文字で入力してください');
  }
  return value;
}

export function parsePostBody(value) {
  if (typeof value !== 'string') throw bad('本文を入力してください');
  const text = value.trim();
  if (!text) throw bad('投稿は空にできません');
  if (codePointLength(text) > MAX_POST_LENGTH) {
    throw bad(`投稿は${MAX_POST_LENGTH}文字以内で入力してください`);
  }
  return text;
}

export function parseModelId(value) {
  if (!MODELS.includes(value)) throw bad('指定されたモデルは使用できません');
  return value;
}

export function parseDisplayName(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || codePointLength(text) > MAX_DISPLAY_NAME_LENGTH) {
    throw bad(`表示名は1〜${MAX_DISPLAY_NAME_LENGTH}文字で入力してください`);
  }
  return text;
}

export function parseInstruction(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || codePointLength(text) > MAX_INSTRUCTION_LENGTH) {
    throw bad(`指示文は1〜${MAX_INSTRUCTION_LENGTH}文字で入力してください`);
  }
  return text;
}

export function parseApiKey(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > MAX_API_KEY_LENGTH) {
    throw bad('APIキーを入力してください');
  }
  return text;
}

export function parseBoolean(value, name) {
  if (typeof value !== 'boolean') throw bad(`${name} は true か false で指定してください`);
  return value;
}
