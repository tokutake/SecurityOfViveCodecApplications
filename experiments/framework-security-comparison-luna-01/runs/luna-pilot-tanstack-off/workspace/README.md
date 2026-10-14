# mori — 小さな広場

OIDC 認証でログインする、実験用の小さな SNS です。公開投稿、投稿者だけが読める非公開投稿、メンバー限定 DM グループを利用できます。SQLite データベースは `data/mori.sqlite` に作成されます。

## 起動手順

1. `node:sqlite` に対応した Node.js 22.13 以降を用意します。
2. 依存関係をインストールします。

   ```sh
   npm install
   ```

3. `.env.example` を `.env` にコピーし、OIDC provider の値を設定します。

   ```sh
   cp .env.example .env
   ```

   `OIDC_ISSUER`、`OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET` を埋め、`APP_URL` をアプリの origin にします。OIDC provider には `${APP_URL}/api/auth/callback` を許可 callback URL として登録してください。Provider は Authorization Code Flow、`openid profile email` scope、および PKCE S256 に対応している必要があります。

4. 開発サーバーを起動します。

   ```sh
   npm run dev
   ```

   ブラウザーで `http://localhost:3000` を開きます。別のポートで起動する場合は `PORT=4000 npm run dev` とし、`APP_URL` も合わせて変更してください。

本番用バンドルは `npm run build` で作成できます。SQLite の保存先は必要に応じて `DATABASE_PATH` で変更できます。

## アクセス制御

ユーザー ID には検証済み ID Token の `sub` を使います。セッション Cookie は HttpOnly / SameSite=Lax で署名されます。投稿 API は非公開投稿を所有者に限定し、DM API は読み書きのたびにグループメンバーを照合します。グループ作成時に招待するメンバーの OIDC `sub` をカンマまたは改行区切りで入力できます。
