# Quietline

OIDCログイン付きの小規模SNSです。公開投稿、本人だけに見える投稿、メンバー限定DMグループをSQLiteに保存します。

## 必要なもの

- Node.js 20.9以上（Next.js 16要件）
- OIDCプロバイダーのIssuer URL、Client ID、Client Secret

## セットアップ

```sh
npm install
cp .env.example .env.local
```

`.env.local`を編集します。OIDCクライアントはAuthorization Codeフローとclient secretを利用できるよう設定し、許可するコールバックURLに`APP_URL`の末尾へ`/api/auth/callback`を足した値を登録してください。Issuerは`/.well-known/openid-configuration`を提供し、`openid`と`profile` scopeをサポートする必要があります。

| 変数 | 説明 |
| --- | --- |
| `OIDC_ISSUER` | OIDC DiscoveryのIssuer URL |
| `OIDC_CLIENT_ID` | OIDCクライアントID |
| `OIDC_CLIENT_SECRET` | OIDCクライアント秘密鍵 |
| `APP_URL` | ブラウザーからアクセスするアプリの完全なURL。例 `http://localhost:3000` |
| `SESSION_SECRET` | 32バイト以上のランダムな秘密値。`openssl rand -base64 48`で生成できます |
| `PORT` | 起動ポート。既定値3000 |
| `DATABASE_PATH` | SQLiteファイルのパス。既定値`./data.sqlite` |

```sh
npm run dev
```

本番用には`npm run build`の後に`npm start`を実行します。`APP_URL`のschemeと実際の公開URLを一致させ、TLS終端の背後ではHTTPSを指定してください。SQLiteファイルとそのディレクトリはアプリ実行ユーザーだけが読み書きできるようにし、バックアップ対象に含めてください。

## 機能

- OIDC Authorization Code + PKCEでログイン。state・nonceとID tokenを検証し、ID tokenの`sub`をユーザー識別子として使用します。
- ログアウトでアプリのHttpOnlyセッションCookieを破棄します。
- 公開投稿は全ログインユーザーに表示され、非公開投稿は本人のAPI応答にだけ含まれます。
- グループ作成者は自動でメンバーになります。グループを選択後、他メンバーのOIDC `sub`と表示名を指定して追加できます。全てのメッセージ読み書きでメンバーシップをサーバー側検証します。
- 投稿・メッセージにID token由来の表示名とUTC保存の投稿日時を表示します。

グループメンバー追加には、追加する人のOIDC `sub`を知っている必要があります。表示名は追加時に入力します。
