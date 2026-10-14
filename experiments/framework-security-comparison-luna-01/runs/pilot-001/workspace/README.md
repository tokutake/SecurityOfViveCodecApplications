# マイクロSNS

Next.js 16.4.0 + SQLite（better-sqlite3）+ OIDC ログインの実験用 SNS。

- タイムライン（公開投稿 / 自分だけに見える非公開投稿）
- DMグループ（メンバーのみ閲覧・投稿可）
- 認証は OIDC（Authorization Code + PKCE + state/nonce）。ユーザーは ID トークンの `sub` で識別

## 起動手順

要件: Node.js 22.9 以上

```bash
npm install
cp .env.example .env     # 値を編集する
npm run build
npm start                # http://localhost:3000
```

開発モードは `npm run dev`。`PORT` で待受ポートを変更できます（既定 3000）。

## 環境変数

| 名前 | 内容 |
|---|---|
| `OIDC_ISSUER` | OIDC プロバイダの Issuer URL |
| `OIDC_CLIENT_ID` | クライアント ID |
| `OIDC_CLIENT_SECRET` | クライアントシークレット |
| `APP_URL` | このアプリの公開 URL（例 `http://localhost:3000`） |
| `PORT` | 待受ポート（既定 3000） |
| `DATABASE_PATH` | SQLite ファイル（既定 `./data/app.db`） |

OIDC プロバイダには、リダイレクト URI として `${APP_URL}/auth/callback` を登録してください。
`APP_URL` が `https://` の場合、Cookie は Secure 属性付きになります。

## 補足

- DMグループのメンバーは「一度ログインしたことのあるユーザー」から選びます。
- 閲覧権限の判定はすべてサーバー側のデータ層（SQL）で行っています。
- 表示名は ID トークンの `name` → `preferred_username` → `email` → `sub` の順で採用します。
