# littlepost

OIDCログイン付きの小さなSNSです。公開タイムライン、本人だけが読める非公開投稿、メンバー限定DMグループをSQLiteに保存します。

## 必要なもの

- Node.js 22以上
- OIDCプロバイダーのクライアント登録

プロバイダーには次のコールバックURLを登録してください。

```
${APP_URL}/callback
```

`${APP_URL}` は実際の公開URL（開発時は `http://localhost:3000`）に置き換えます。クライアントはAuthorization Codeフローを有効にし、`openid profile` scopeを許可してください。ログアウト時にプロバイダー側のセッションも終了するには、`APP_URL/` を許可済みpost-logout redirect URIとして登録します。

## 起動

```sh
npm install
cp .env.example .env
```

`.env` を編集します。

- `OIDC_ISSUER`: OIDC issuer URL（discovery URLではなくissuer）
- `OIDC_CLIENT_ID`: クライアントID
- `OIDC_CLIENT_SECRET`: クライアントシークレット
- `APP_URL`: ブラウザーからアクセスするアプリの完全なorigin
- `SESSION_SECRET`: 32文字以上のランダムな秘密値
- `PORT`: 待受ポート、省略時 `3000`
- `DATABASE_PATH`: SQLiteファイルの場所、省略時 `./data.sqlite`

`SESSION_SECRET` は例えば `openssl rand -base64 48` で生成できます。`.env` とSQLiteファイルを公開・共有しないでください。

```sh
npm start
```

ブラウザーで `APP_URL` を開き、OIDCログインします。SQLiteファイルは初回起動時に作られます。終了は Ctrl+C です。

## 使い方

- トップ画面から公開投稿、または「自分だけに公開」を選んだ非公開投稿を作成できます。
- DMグループを作成するには、メンバーのOIDC `sub` を入力します。メンバーは先に一度ログインしている必要があります。作成後はグループ画面でメンバーを追加できます。
- 投稿・メッセージには表示名と日本時間の投稿日時を表示します。
- ログアウトではアプリ内セッションを破棄し、プロバイダーにend-session endpointがあればID token hint付きで遷移します。

## 運用上の注意

本アプリはHTTPSのリバースプロキシ配下での運用を想定します。TLS終端プロキシを使う場合、`APP_URL` はHTTPSにし、プロキシが正しく `X-Forwarded-Proto` を渡す構成で `TRUST_PROXY=1` を設定してください。SQLiteファイルのバックアップとアクセス制御も設定してください。アカウント登録機能はなく、グループメンバーとして追加できるのは一度ログイン済みのsubのみです。
