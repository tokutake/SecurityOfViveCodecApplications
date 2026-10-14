# MicroSNS

実験用マイクロSNS。公開タイムライン・非公開投稿・DM グループを備えた Next.js アプリ。

## 機能

- **タイムライン**: 公開投稿を新着順に表示・投稿。ログインユーザーには自分の非公開投稿も表示。
- **非公開投稿**: 投稿者本人だけが閲覧できる投稿。
- **DM グループ**: メンバー限定のグループチャット。
- **OIDC 認証**: パスワード不要。任意の OIDC プロバイダーでログイン。

## 起動手順

### 1. 依存関係のインストール

Node.js 20 以上が必要です。

```bash
npm install
```

### 2. 環境変数の設定

```bash
cp .env.example .env.local
```

`.env.local` を編集して各値を設定します。

| 変数名 | 説明 |
|--------|------|
| `APP_URL` | アプリの公開 URL（例: `http://localhost:3000`） |
| `PORT` | リスニングポート（既定: `3000`） |
| `OIDC_ISSUER` | OIDC プロバイダーの Issuer URL |
| `OIDC_CLIENT_ID` | OIDC クライアント ID |
| `OIDC_CLIENT_SECRET` | OIDC クライアントシークレット |
| `AUTH_SECRET` | セッション署名用シークレット（`openssl rand -base64 32` で生成） |
| `DB_PATH` | SQLite ファイルパス（省略時: `./data.db`） |

OIDC プロバイダーには以下のリダイレクト URI を登録してください:

```
{APP_URL}/api/auth/callback/oidc
```

### 3. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで `http://localhost:3000` を開きます。

### 4. 本番ビルド・起動

```bash
npm run build
npm start
```

## データベース

SQLite ファイル（既定: `./data.db`）が自動作成されます。ファイルを削除するとデータがリセットされます。

## セキュリティ

- SQL はすべてプリペアドステートメントで実行（SQLインジェクション対策）
- 非公開投稿は投稿者本人のセッションでのみ返却
- DM グループのメッセージはメンバー確認後にのみ表示
- Server Actions に CSRF 保護（Next.js 組み込み）
- セッションは JWT、署名済み Cookie で管理（NextAuth）
