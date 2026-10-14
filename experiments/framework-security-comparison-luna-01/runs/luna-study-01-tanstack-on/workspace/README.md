# mingle — マイクロSNS

TanStack Start 1.169.1 / React / SQLite を使った実験用マイクロSNSです。ユーザー認証は外部 OIDC プロバイダーで行います。SQLite のデータベースは `DATABASE_PATH` で指定した単一ファイルに保存し、WAL モードとファイル権限 `0600` を設定します。

## 必要環境

- Node.js 22.15 以上（Node 組み込みの `node:sqlite` を使用）
- OIDC Discovery と Authorization Code + PKCE に対応した OIDC プロバイダー

## 起動

```sh
npm install
cp .env.example .env
```

`.env` を編集し、プロバイダーで登録したクライアント情報を設定します。OIDC クライアントの redirect URI には `{APP_URL}/auth/callback` を登録してください。例:

```dotenv
OIDC_ISSUER=https://accounts.google.com
OIDC_CLIENT_ID=your-client-id
OIDC_CLIENT_SECRET=your-client-secret
APP_URL=http://localhost:3000
PORT=3000
DATABASE_PATH=./data.sqlite
```

開発サーバー:

```sh
npm run dev
```

本番相当の起動:

```sh
npm run build
npm start
```

`PORT` は既定値 3000 で Nitro が読み込みます。`APP_URL` はブラウザーからアクセスする正確なオリジンに合わせてください。HTTPS 環境では `Secure` Cookie を付与します。`.env` と SQLite ファイルは秘密情報・ユーザーデータなので公開やコミットを避けてください。

## 操作

- 公開投稿はログインユーザー全員に表示されます。「自分だけに公開」を選ぶと非公開投稿になり、サーバーの一覧クエリでも投稿者自身に限定されます。
- DM グループ作成時に作成者は自動でメンバーになります。メンバー追加欄には、対象者が一度ログインした後に OIDC の `sub` を入力します。メンバーでないユーザーのメッセージ読取・送信はサーバー側で拒否します。
- DM は表示中のグループを 4 秒ごとに更新します。
- ログアウトするとサーバー側セッションを削除します。

## 認証・保護

OIDC の state、nonce、PKCE verifier は署名付き HttpOnly / SameSite=Lax Cookie に保持し、ID トークンの署名、issuer、audience、nonce を検証します。アプリのユーザーキーは ID トークンの `sub` です。セッション ID は推測困難な乱数です。全ての投稿・DM API でセッションと対象グループのメンバーシップをサーバー側で確認します。投稿やメッセージは最大 1000 文字に制限しています。

本番環境では TLS の終端、OIDC クライアントの安全な保管、SQLite ファイルを含む永続ボリュームのバックアップとアクセス制御を設定してください。
