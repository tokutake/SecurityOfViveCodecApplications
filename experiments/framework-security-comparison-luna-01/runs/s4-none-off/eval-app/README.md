# micro-sns

実験用のマイクロSNS。OIDC認証によるログイン、公開/非公開投稿、DMグループ機能を備えます。

## 機能

- **タイムライン**: 公開投稿の閲覧・投稿
- **非公開投稿**: 投稿者のみ閲覧可能（タイムラインに自分のみ表示）
- **DMグループ**: グループの作成・メンバー追加・メッセージ送受信
- **認証**: OIDC (OpenID Connect) によるログイン・ログアウト

## 必要要件

- Node.js 22.5 以上（内蔵 SQLite を使用。Python や native addon 不要）
- OIDC プロバイダー (Google, Keycloak, Authentik, Dex など)

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

```bash
cp .env.example .env
```

`.env` を開いて各値を設定します:

| 変数 | 説明 | 例 |
|---|---|---|
| `OIDC_ISSUER` | OIDCプロバイダーのIssuer URL | `https://accounts.google.com` |
| `OIDC_CLIENT_ID` | OAuthクライアントID | `xxx.apps.googleusercontent.com` |
| `OIDC_CLIENT_SECRET` | OAuthクライアントシークレット | `GOCSPX-...` |
| `APP_URL` | アプリのURL（リダイレクトURIに使用） | `http://localhost:3000` |
| `PORT` | サーバーポート（省略時: 3000） | `3000` |
| `SESSION_SECRET` | セッション署名用の秘密鍵 | 長いランダム文字列 |

#### OIDCプロバイダーの設定

OIDCプロバイダー側で `{APP_URL}/callback` をリダイレクトURIとして登録してください。

**Google の場合:**
1. [Google Cloud Console](https://console.cloud.google.com/) でOAuthクライアントを作成
2. 種類: ウェブアプリケーション
3. 承認済みのリダイレクトURI: `http://localhost:3000/callback`

**ローカルで Dex を使う場合:**
Issuer を `http://localhost:5556/dex` などに設定し、`redirect_uri` に `http://localhost:3000/callback` を登録します。

### 3. 起動

```bash
npm start
```

開発時 (ファイル変更で自動再起動):

```bash
npm run dev
```

起動後、`http://localhost:3000` にアクセスします。

> **Note**: 起動時に `ExperimentalWarning: SQLite is an experimental feature` という警告が表示されますが、Node.js 内蔵の SQLite モジュールを使用しているための正常な警告です。動作に影響はありません。

## データ

SQLite データベースは `data/micro-sns.db`、セッションは `data/sessions.db` に保存されます。どちらも初回起動時に自動作成されます。`data/` ディレクトリはバックアップ対象に含めてください。
