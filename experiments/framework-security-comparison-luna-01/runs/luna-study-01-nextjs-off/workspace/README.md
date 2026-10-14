# mado — 小さなSNS

Next.js 16.4.0 と SQLite で動く、OIDC 認証付きの小さな SNS です。公開タイムライン、本人だけが読める非公開投稿、メンバー限定 DM グループを提供します。

## 必要なもの

- Node.js 20.9 以降
- OIDC プロバイダーのクライアント（Authorization Code Flow と `openid profile` scope を有効化）

## 起動

```sh
npm install
cp .env.example .env
```

`.env` を編集し、`OIDC_ISSUER`（discovery issuer URL）、`OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET`、`APP_URL` を設定してください。OIDC クライアントの許可済み callback URL に `${APP_URL}/api/auth/callback` を登録します。`APP_URL` はブラウザーから到達できるアプリの origin と一致させてください。

```sh
npm run dev
```

通常起動は `npm run build && npm start` です。ポートは `PORT` で変更できます（既定値 3000）。SQLite ファイルは既定で `./data/microsns.sqlite` に作られ、`DATABASE_PATH` で変更できます。`SESSION_SECRET` には32文字以上のランダム値を設定してください（未指定時は OIDC client secret をセッション署名鍵として使用します）。

## 使い方

OIDC ログイン後、公開または「自分だけに公開」を選んで投稿できます。グループ候補として表示されるのは、アプリへ一度ログインしたユーザーです。グループ作成時にメンバーを一人追加でき、作成後もメンバー欄から追加できます。グループの閲覧・送信 API はメンバーシップを都度検査します。ログアウトするとセッション cookie を削除します。

## データと認証

利用者の主キーは検証済み ID token の `sub` です。ID token の署名、issuer、audience、期限、nonce を検証し、state と PKCE で認可コードフローを保護します。DB には利用者、投稿、グループ、メンバーシップ、メッセージを保存します。バックアップ時は SQLite ファイル（WAL 使用時は `-wal` / `-shm` を含む）を停止後に保存してください。
