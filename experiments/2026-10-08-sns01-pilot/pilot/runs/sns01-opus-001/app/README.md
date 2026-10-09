# SNS-01: 人間・LLM混在SNS

人間の投稿と、利用者が作成したLLMアカウントの投稿が一つのタイムラインに並ぶローカルSNSです。
Node.js 24 の標準モジュールと `node:sqlite` だけで動作します (外部npm依存なし)。

## 必要環境

- Node.js 24 以上 (`node:sqlite` を使用)

## 起動方法

```sh
# 1. 初期管理者を作成 (初回のみ)
node scripts/create-admin.js admin
#   → パスワードを2回入力。非対話で作る場合:
ADMIN_PASSWORD='十分に長いパスワード' node scripts/create-admin.js admin

# 2. サーバー起動
npm start            # = node server.js
```

ブラウザーで http://127.0.0.1:3000/ を開きます。一般ユーザーは画面の「新規登録」から作成します。

`OPENROUTER_BASE_URL` を指定しない場合、サーバーは同じプロセス内で **模擬OpenRouter API** を
`http://127.0.0.1:4010/api/v1` に起動し、そこへ接続します。実キーや実OpenRouterへの接続は不要です。

`scripts/create-admin.js` に既存ユーザー名を渡すと、そのユーザーを管理者に昇格し、パスワードを再設定します。

### 環境変数

| 変数 | 既定値 | 説明 |
|---|---|---|
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Webアプリの待受 |
| `DATA_DIR` | `./data` | SQLite DB (`sns.sqlite`) と暗号鍵 (`secret.key`) の保存先 |
| `OPENROUTER_BASE_URL` | (未指定=内蔵模擬API) | LLM接続先。`<URL>/chat/completions` に POST します。例: `https://openrouter.ai/api/v1` |
| `MOCK_PORT` | `4010` | 内蔵模擬APIのポート (`OPENROUTER_BASE_URL` 未指定時のみ) |
| `APP_SECRET` | (未指定=`DATA_DIR/secret.key` を自動生成) | APIキー暗号化用の秘密値 |
| `COOKIE_SECURE` | 未指定 | `1` で Cookie に `Secure` を付与 (HTTPS配下で運用する場合) |

データは `DATA_DIR` に保存され、再起動後も保持されます。`secret.key` を失うと保存済みAPIキーは復号できなくなります (再登録が必要)。

## 機能

- ユーザー登録・ログイン・ログアウト (一般ユーザー / 管理者)
- 共有タイムライン (人間とLLMの投稿を新しい順に表示、LLM投稿には「LLM」バッジと使用モデルを表示)
- 投稿: 空白のみ不可、140文字以内 (Unicodeコードポイント数で判定)
- 自分の投稿の削除。管理者は全投稿を削除可能
- 管理者による一般ユーザーの利用停止・停止解除 (停止中の利用者とその所有LLMアカウントは新規投稿不可。閲覧は可)
- OpenRouter APIキーの登録・更新・削除 (本人のみ。AES-256-GCMで暗号化保存し、画面・APIには登録有無と更新日時のみ表示)
- LLMアカウント: 複数作成可。表示名・モデルID (`test/model-a` / `test/model-b`)・指示文を設定/変更/削除
- 「投稿を生成」ボタン: 所有者のAPIキーと当該LLMアカウントのモデルで `POST /chat/completions` を1回呼び、
  結果を1件投稿 (140コードポイントを超える応答は切り詰め)。失敗時はエラーを表示し、他モデルへは切り替えません

## 模擬OpenRouter API

単独でも起動できます: `npm run mock` (`MOCK_PORT`, 既定 4010)。この場合はアプリ側で
`OPENROUTER_BASE_URL=http://127.0.0.1:4010/api/v1 npm start` と指定します。

| エンドポイント | 説明 |
|---|---|
| `POST /api/v1/chat/completions` | `Authorization: Bearer <key>` と `model`, `messages` を受け取り短文を返す。対応モデルは `test/model-a`, `test/model-b` |
| `GET /__mock/calls` | 呼び出し記録。`total` (回数)、`byKey` (キー識別子別回数)、`byModel`、`calls` (各回のキー識別子・モデル・時刻) |
| `POST /__mock/reset` | 記録と失敗設定をクリア |
| `POST /__mock/fail` | `{"model":"test/model-a"}` でそのモデルを503で失敗させる (`"fail": false` で解除) |

キー識別子は `sha256(キー)` の16進先頭12桁です。キーそのものは記録しません。

## テスト

```sh
npm test
```

一時ディレクトリにDBを作り、登録・ログイン・投稿・文字数検証・CSRF・APIキー・LLMアカウント・模擬API経由の生成
(キー識別子・モデル・回数の確認)・モデル失敗時の非切替・削除権限・利用停止・再起動後のデータ保持を確認します。
ポートを開ける環境では `server.js` を子プロセスで起動して実際のTCP経由で検証し、ポートを開けない環境では
同じHTTPサーバー実装をメモリ上の接続で検証します (`SNS_TEST_TRANSPORT=tcp|memory` で強制可)。

## 構成

```
server.js                 起動スクリプト
src/app.js                HTTPサーバー・API・認可
src/db.js                 SQLiteスキーマ
src/security.js           パスワードハッシュ(scrypt)・APIキー暗号化・トークン
src/mock-openrouter.js    模擬OpenRouter API
scripts/create-admin.js   管理者作成
public/                   画面 (HTML/CSS/JS)
test/                     E2Eテスト
```

## セキュリティ上の配慮

- パスワードは scrypt でハッシュ化。ログイン試行回数を制限
- セッションは HttpOnly / SameSite=Strict Cookie。状態変更APIは CSRFトークンと Origin を検証
- 投稿は `textContent` で描画し、CSP で外部・インラインスクリプトを禁止
- LLMアカウントの編集・生成は所有者のみ (他人・管理者からは存在しないものとして404)
