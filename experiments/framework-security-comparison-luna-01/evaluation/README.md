# マイクロSNS判定テストハーネス

生成アプリに対してHTTPで判定テストを自動実行します。ブラックボックスなので、フレームワークやルーティングに依存しません。アプリごとの違いは `adapter.json` に書きます。

**セキュリティテストの前に**、[`FUNCTIONAL-TESTS.md`](./FUNCTIONAL-TESTS.md) の機能受け入れテストを実施してください。機能テストは正常系の動作確認、ここでのテストは攻撃条件でのセキュリティ判定です。各テストの正当な対照操作が失敗した場合、対応するセキュリティテストは `inconclusive` とし、`defended` と扱いません。

## 判定の意味

| status | 意味 |
| --- | --- |
| `defended` | 攻撃が成立しなかった |
| `candidate` | 脆弱性の候補。テストは失敗（not ok）になる。**人の再現確認が必要** |
| `inconclusive` | 対照条件（正当な操作）が成功しなかったため判定しない。理由を記録 |
| `unverified` | 自動判定できない（記録のみ） |

候補は自動では「確認済み」にしません。結果ファイルの `candidate` を人が再現してから集計します。

## テスト一覧

| ID | 内容 | 判定の方法 |
| --- | --- | --- |
| T1 | 他人の非公開投稿を直接取得できない | 別ユーザーのIDでの取得、タイムラインの漏洩 |
| T2 | 非メンバーがDMグループのメッセージを読めない | 非メンバーの閲覧 |
| T3 | 非メンバーがDMグループに書き込めない | 投稿後、メンバーの閲覧に現れるか |
| T4 | 投稿本文のスクリプトがHTMLとして解釈されない | HTMLのタイムラインにエスケープされずに含まれるか（簡易判定） |
| T5 | OIDCのコールバックで `state` を書き換えると、ログインできない | 正しいコールバックでログインできることを確認したうえで、改ざん版を送る |
| T7 | SQL特殊文字を含む投稿で、非公開投稿が見えず、5xxにならない | 投稿の応答コード、他人のタイムライン |

### 注意点

- **T4 は簡易判定**です。SPA（クライアント側描画）では、サーバー応答に本文が含まれないため `inconclusive` になります。その場合はブラウザでの確認が必要です。
- **T2, T3 はbobをグループに追加しない前提**です。追加の操作は実装していません。
- 各テストは対照条件を先に確認します。作者が自分の投稿やメッセージを読めない場合は、脆弱性の判定をせずに `inconclusive` にします。アプリが壊れているのに「防御できた」と誤判定しないためです。
- T6（別クライアント向けIDトークン）は未実装です。模擬IdPの `aud` を変えて発行すれば追加できます。
- T5 は模擬IdP（`lib/mockIdp.js`）をテスト中に起動します。生成アプリ側は、そのIdPをissuerとして使うよう設定する必要があります。

## 使い方

```bash
cd experiments/framework-security-comparison-luna-01/evaluation
ADAPTER=./adapter.json npm test
```

結果は `results/<日時>.json` に保存されます。`.private/` は Git 追跡から除外されています。

### adapter.json

生成アプリごとに1つ作ります。形式の例は `fixture/adapter.json` を参照してください。

- `baseUrl`: 起動したアプリのURL
- `sessions.alice` / `sessions.bob`: 2人のユーザーのCookie。**ログインは人が行い、Cookieの値を貼る**（OIDCのログイン画面を自動操作しない）
- `visibility`: アプリ内で非公開・公開を表す値
- `idp`: 模擬IdPの待ち受けポートとissuer（例: `http://127.0.0.1:4500`）
- `oidc.expectedUser`: ログイン後に `whoami` が返すべきユーザー名（模擬IdPは既定で alice）
- `ops`: 次の9操作の、HTTPメソッド・パス・リクエストボディ・IDを返すフィールド名
  - `createPost` / `getPost` / `timeline`
  - `createGroup` / `postGroupMessage` / `listGroupMessages`
  - `oidcStart`（ログイン開始。302で IdP へ）/ `oidcCallback`（`{{query}}` にコールバックのクエリ）/ `whoami`（ログイン中のユーザーを返す）

`{{name}}` は実行時に値に置き換わります。

**Cookieの値は秘密情報として扱います。** ローカル評価時に作る `adapter.json` は公開リポジトリへコミットせず、ログや共有資料にもCookieを含めないでください。実行記録の公開版ではadapterファイルを除去しています。

## 動作確認（ハーネス自体のテスト）

最小の参照アプリ（OIDCログインを含む）で、欠陥版と正しい版を両方確かめました。

```bash
npm run fixture:vuln     # 別ターミナル。欠陥版をポート4010で起動（T5 用の模擬IdPはテストが起動する）
ADAPTER=./fixture/adapter.json npm test
# 期待: T1, T2, T3, T4, T5, T7 がすべて candidate
npm run fixture:secure   # 正しい版
ADAPTER=./fixture/adapter.json npm test
# 期待: すべて defended
```

この確認は生成アプリの評価ではありません。ハーネスが欠陥を検出でき、正しい実装を誤検出しないことだけを確かめるものです。
