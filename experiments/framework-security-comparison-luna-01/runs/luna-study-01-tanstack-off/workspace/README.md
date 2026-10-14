# こえ — 小さなSNS

TanStack Start 1.169.1 を使った、SQLite 保存の小さなSNSです。OIDC Authorization Code Flow でログインし、IDトークンの `sub` をユーザー識別子に使います。

## 起動

Node.js 22.13 以降（組み込みの `node:sqlite` を使用）を用意し、依存関係をインストールします。

```sh
npm install
cp .env.example .env
```

`.env` に OIDC プロバイダーの値を設定してください。プロバイダーには `APP_URL/auth/callback` をリダイレクトURIとして登録します。`SESSION_SECRET` は32文字以上のランダムな秘密値に置き換えてください。例: `openssl rand -base64 48`。

```sh
set -a; . ./.env; set +a
npm run dev
```

既定ポートは3000です。`PORT=4000` のように指定できます。ビルド後は `npm run build`、`PORT=3000 npm start` で起動できます。SQLiteファイルは既定で `data/microsns.sqlite` に作成されます。`DB_PATH` で場所を変更できます。

## 使い方

- 「OIDCでログイン」からログインし、公開または「自分だけに公開」を選んで投稿します。
- グループ作成時、アプリに一度ログインしたユーザーをメンバーに選べます。作成後はメンバーのみがメッセージの読み書きをできます。
- DM のメンバー追加も、ログイン済みユーザーから選択して行います。
- 右上からログアウトできます。

SQLite の投稿・グループ・メンバー・メッセージはアプリ再起動後も残ります。認証セッションは HttpOnly/SameSite Cookie で7日間保持します。
