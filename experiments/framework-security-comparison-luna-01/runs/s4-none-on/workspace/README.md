# MicroSNS

実験用のマイクロSNSアプリです。OIDCによる認証、公開/非公開投稿、DMグループメッセージに対応しています。

## 機能

- **タイムライン** — 公開投稿の一覧表示・投稿。ログイン中は自分の非公開投稿も表示。
- **非公開投稿** — 投稿者のみが閲覧できる投稿。
- **DMグループ** — グループを作成し、メンバー同士でメッセージをやり取り。
- **OIDC認証** — パスワード不要のシングルサインオン。

## セットアップ

### 1. 依存関係のインストール

```bash
cd /path/to/project
npm install
```

Node.js 18 以上が必要です。

### 2. 環境変数の設定

`.env.example` をコピーして `.env` を作成し、各設定値を記入してください。

```bash
cp .env.example .env
```

`SESSION_SECRET` には十分にランダムな長い文字列を使用してください。

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 3. OIDCプロバイダーの設定

使用するOIDCプロバイダー（Google、Auth0、Keycloak など）で以下を設定してください。

- **Redirect URI**: `{APP_URL}/auth/callback`
  - 例: `http://localhost:3000/auth/callback`

### 4. 起動

```bash
npm start
```

開発時（ファイル変更で自動再起動）:

```bash
npm run dev
```

ブラウザで `http://localhost:3000` にアクセスしてください。

## 環境変数

| 変数名 | 説明 | 必須 | 既定値 |
|---|---|:---:|---|
| `OIDC_ISSUER` | OIDCプロバイダーのIssuer URL | ✓ | — |
| `OIDC_CLIENT_ID` | OIDCクライアントID | ✓ | — |
| `OIDC_CLIENT_SECRET` | OIDCクライアントシークレット | ✓ | — |
| `APP_URL` | アプリのベースURL（末尾スラッシュなし） | ✓ | — |
| `SESSION_SECRET` | セッション暗号化シークレット | ✓ | — |
| `PORT` | リッスンポート | — | `3000` |
| `DATABASE_PATH` | SQLiteデータベースファイルパス | — | `./data/app.db` |
| `NODE_ENV` | `production` でCookieにSecureフラグを付与 | — | `development` |

## データ

SQLiteデータベースは `data/app.db`、セッションストアは `data/sessions.db` に自動作成されます。
