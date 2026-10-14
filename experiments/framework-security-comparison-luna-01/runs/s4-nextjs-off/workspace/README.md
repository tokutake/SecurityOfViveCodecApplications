# マイクロSNS

実験用の小さな SNS アプリです。公開タイムライン・非公開投稿・DM グループ機能を備えています。

## 機能

- **タイムライン**: 公開投稿の閲覧と投稿
- **非公開投稿**: 自分だけが見られる非公開の投稿
- **DM グループ**: グループを作成し、メンバーとメッセージをやり取り
- **OIDC 認証**: パスワード不要のシングルサインオン

## 前提条件

- Node.js 20 以上
- OIDC プロバイダー（例: Keycloak, Auth0, Google など）

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env.example` をコピーして `.env.local` を作成し、値を設定してください。

```bash
cp .env.example .env.local
```

| 変数名              | 説明                                                  |
| ------------------- | ----------------------------------------------------- |
| `OIDC_ISSUER`       | OIDC プロバイダーの Issuer URL                        |
| `OIDC_CLIENT_ID`    | OIDC クライアント ID                                  |
| `OIDC_CLIENT_SECRET`| OIDC クライアントシークレット                         |
| `APP_URL`           | アプリの公開 URL（例: `http://localhost:3000`）        |
| `AUTH_SECRET`       | セッション署名用シークレット（後述の生成コマンドを使用）|
| `PORT`              | リッスンポート（省略時: 3000）                        |
| `DB_PATH`           | SQLite ファイルのパス（省略時: `./data.db`）           |

#### AUTH_SECRET の生成

```bash
openssl rand -base64 32
```

### 3. OIDC プロバイダーの設定

OIDC プロバイダー側で以下のリダイレクト URI を許可してください。

```
{APP_URL}/api/auth/callback/oidc
```

例: `http://localhost:3000/api/auth/callback/oidc`

### 4. 起動

#### 開発サーバー

```bash
npm run dev
```

#### 本番ビルド & 起動

```bash
npm run build
npm start
```

#### ポートを変更して起動

```bash
PORT=8080 npm start
```

## データベース

SQLite ファイル（デフォルト: `./data.db`）が自動的に作成されます。
初回起動時にテーブルが自動作成されます。

## 技術スタック

- **フレームワーク**: Next.js 16.4.0 (App Router)
- **認証**: Auth.js (NextAuth) v5 + OIDC
- **データベース**: SQLite (better-sqlite3)
- **スタイル**: Tailwind CSS
