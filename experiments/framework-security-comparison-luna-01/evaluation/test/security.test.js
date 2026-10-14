// マイクロSNSの判定用テスト（T1〜T5, T7）。
// 判定は「候補」まで。失敗（not ok）は脆弱性の候補を意味し、人の再現確認が必要。
// 対照条件（正当な操作が成功すること）が満たされない場合は判定せず inconclusive とする。
// アプリに対応する操作がない場合は、そのテストの一部を「対象外」として記録する。
//
// 実行: ADAPTER=./adapter.json npm test

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { loadAdapter, createClient, isSuccess } from "../lib/client.js";
import { startMockIdp } from "../lib/mockIdp.js";

const adapter = await loadAdapter(process.env.ADAPTER ?? new URL("../adapter.json", import.meta.url).pathname);
const client = createClient(adapter);
const nonce = Date.now().toString(36);
const records = [];
// idp.external が true のときは、常駐の模擬IdP（lib/mockIdp.js）を使う。テストでは起動しない
const idpLocal = adapter.idp?.localIssuer ?? adapter.idp?.issuer;
const idp = !adapter.idp ? null : adapter.idp.external
  ? { setSub: async (sub) => (await fetch(`${idpLocal}/__set-sub?sub=${sub}`)).ok, close: async () => {} }
  : await startMockIdp(adapter.idp);

// 模擬IdPで1人分ログインし、アプリのセッションCookieを得る
async function loginAs(role) {
  await idp.setSub(role);
  const flow = await authorizeOnce();
  if (!flow) throw new Error(`${role} のログインを開始できない`);
  const res = await client.call("oidcCallback", { cookie: flow.cookie, vars: { query: flow.callback.search } });
  if (!res.setCookie) throw new Error(`${role} のログインでセッションが発行されない (status ${res.status})`);
  return res.setCookie;
}

// sessions が "oidc" のときは、テスト開始時に alice と bob をログインさせる
let loginSetupError = null;
if (adapter.sessions === "oidc") {
  if (!idp) throw new Error("sessions を oidc にするには idp の設定が必要です");
  try {
    adapter.sessions = { alice: await loginAs("alice"), bob: await loginAs("bob") };
  } catch (error) {
    loginSetupError = String(error);
    records.push({ id: "SETUP", status: "inconclusive", detail: loginSetupError, at: new Date().toISOString() });
    adapter.sessions = { alice: "", bob: "" };
  }
}

function record(id, status, detail) {
  records.push({ id, status, detail, at: new Date().toISOString() });
}

// 対照条件が成り立たないとき。脆弱性の有無は判定しない
function inconclusive(t, id, reason) {
  record(id, "inconclusive", reason);
  t.skip(reason);
}

// leaked が true なら候補として失敗させる
function judge(id, leaked, detail) {
  record(id, leaked ? "candidate" : "defended", detail);
  assert.equal(leaked, false, `${id} 脆弱性の候補: ${detail}`);
}

after(async () => {
  const dir = new URL("../results/", import.meta.url);
  await mkdir(dir, { recursive: true });
  const file = new URL(`${new Date().toISOString().replace(/[:.]/g, "-")}.json`, dir);
  await writeFile(file, JSON.stringify({ adapter: adapter.name ?? "unnamed", records }, null, 2));
  console.log(`結果を保存: ${file.pathname}`);
  if (idp) await idp.close();
});

async function createPrivatePost(text) {
  return client.call("createPost", { as: "alice", vars: { text, visibility: adapter.visibility.private } });
}

// グループを作り、必要ならメンバーを追加する。
// アプリがメンバーの追加を別の操作にしている場合は、作成後に addMember で追加する
async function createGroup(members = []) {
  const group = await client.call("createGroup", { as: "alice", vars: { name: `group-${nonce}`, members: client.hasOp("addMember") ? [] : members } });
  if (!isSuccess(group) || group.id === undefined || !client.hasOp("addMember")) return group;
  for (const member of members) {
    const added = await client.call("addMember", { as: "alice", vars: { id: group.id, member } });
    if (!isSuccess(added)) return { ...added, id: undefined };
  }
  return group;
}

test("T1 他人の非公開投稿を取得できない", async (t) => {
  if (loginSetupError) return inconclusive(t, "T1", `ログイン初期化失敗: ${loginSetupError}`);
  const secret = `T1-${nonce}`;
  const created = await createPrivatePost(secret);
  if (!isSuccess(created)) {
    return inconclusive(t, "T1", `対照失敗: 作者による非公開投稿の作成 (status ${created.status})`);
  }
  const ownTimeline = await client.call("timeline", { as: "alice" });
  if (!isSuccess(ownTimeline) || !ownTimeline.text.includes(secret)) {
    return inconclusive(t, "T1", `対照失敗: 作者が自分の非公開投稿を見られない (status ${ownTimeline.status})`);
  }

  // 投稿の個別ページ（getPost）があるアプリだけ、直接取得も確かめる
  let directPart = "直接取得は対象外（個別ページなし）";
  let leakedById = false;
  if (client.hasOp("getPost") && created.id !== undefined) {
    const direct = await client.call("getPost", { as: "bob", vars: { id: created.id } });
    leakedById = isSuccess(direct) && direct.text.includes(secret);
    directPart = `直接取得 ${direct.status}${leakedById ? "（本文が含まれる）" : ""}`;
  }

  const timeline = await client.call("timeline", { as: "bob" });
  const leakedInTimeline = isSuccess(timeline) && timeline.text.includes(secret);
  judge("T1", leakedById || leakedInTimeline, `${directPart} / タイムライン ${leakedInTimeline ? "に漏洩" : "に漏洩なし"}`);
});

test("T2 非メンバーがDMグループのメッセージを読めない", async (t) => {
  if (loginSetupError) return inconclusive(t, "T2", `ログイン初期化失敗: ${loginSetupError}`);
  const group = await createGroup();
  if (!isSuccess(group) || group.id === undefined) {
    return inconclusive(t, "T2", `対照失敗: グループ作成 (status ${group.status})`);
  }
  const secret = `T2-${nonce}`;
  const posted = await client.call("postGroupMessage", { as: "alice", vars: { id: group.id, text: secret } });
  const own = await client.call("listGroupMessages", { as: "alice", vars: { id: group.id } });
  if (!isSuccess(posted) || !isSuccess(own) || !own.text.includes(secret)) {
    return inconclusive(t, "T2", `対照失敗: メンバーがメッセージを投稿・閲覧できない (post ${posted.status}, list ${own.status})`);
  }

  // bob は作成したグループのメンバーとして追加していない
  const outsider = await client.call("listGroupMessages", { as: "bob", vars: { id: group.id } });
  judge("T2", isSuccess(outsider) && outsider.text.includes(secret), `非メンバーの読み取り ${outsider.status}`);
});

test("T3 非メンバーがDMグループに書き込めない", async (t) => {
  if (loginSetupError) return inconclusive(t, "T3", `ログイン初期化失敗: ${loginSetupError}`);
  // 対照: メンバー（bob）がメンバーの画面のフォームを再送すると、保存される
  const controlGroup = await createGroup(["bob"]);
  if (!isSuccess(controlGroup) || controlGroup.id === undefined) {
    return inconclusive(t, "T3", `対照失敗: bob をメンバーにしたグループ作成 (status ${controlGroup.status})`);
  }
  const controlMarker = `T3-control-${nonce}`;
  const controlReplay = await client.call("postGroupMessage", { as: "bob", formAs: "alice", csrfFrom: { as: "bob", page: "/" }, vars: { id: controlGroup.id, text: controlMarker } });
  const controlView = await client.call("listGroupMessages", { as: "alice", vars: { id: controlGroup.id } });
  if (!isSuccess(controlView) || !controlView.text.includes(controlMarker)) {
    return inconclusive(t, "T3", `対照失敗: メンバーによるフォームの再送が保存されない (post ${controlReplay.status}, list ${controlView.status})`);
  }

  // 攻撃: bob はメンバーでないグループに、メンバーのフォームを再送して書き込む
  const group = await createGroup();
  if (!isSuccess(group) || group.id === undefined) {
    return inconclusive(t, "T3", `対照失敗: グループ作成 (status ${group.status})`);
  }
  const own = await client.call("postGroupMessage", { as: "alice", vars: { id: group.id, text: `T3-own-${nonce}` } });
  if (!isSuccess(own)) {
    return inconclusive(t, "T3", `対照失敗: メンバーの投稿 (status ${own.status})`);
  }

  const marker = `T3-${nonce}`;
  const attempt = await client.call("postGroupMessage", { as: "bob", formAs: "alice", csrfFrom: { as: "bob", page: "/" }, vars: { id: group.id, text: marker } });
  const view = await client.call("listGroupMessages", { as: "alice", vars: { id: group.id } });
  if (!isSuccess(view)) {
    return inconclusive(t, "T3", `対照失敗: メンバーによる閲覧 (status ${view.status})`);
  }
  // 応答が成功でも、保存されていなければ書き込みは成立していない
  judge("T3", isSuccess(attempt) && view.text.includes(marker), `非メンバーの投稿 ${attempt.status}（対照の再送は保存されたことを確認済み）`);
});

test("T4 投稿本文のスクリプトがHTMLとして解釈されない", async (t) => {
  if (loginSetupError) return inconclusive(t, "T4", `ログイン初期化失敗: ${loginSetupError}`);
  const payload = `<script>/*T4-${nonce}*/</script>`;
  const created = await client.call("createPost", { as: "alice", vars: { text: payload, visibility: adapter.visibility.public } });
  if (!isSuccess(created)) {
    return inconclusive(t, "T4", `対照失敗: 公開投稿の作成 (status ${created.status})`);
  }

  const page = await client.call("timeline", { as: "bob" });
  if (!isSuccess(page) || !page.text.includes(`T4-${nonce}`)) {
    // SPA でクライアント側描画の場合はサーバー応答に本文が無い。ブラウザでの確認が必要
    return inconclusive(t, "T4", "タイムラインの応答に投稿が含まれない（クライアント側描画の可能性。ブラウザ検査が必要）");
  }

  const raw = page.text.includes(payload);
  if (raw && page.contentType.includes("text/html")) {
    return judge("T4", true, "HTMLのタイムラインにスクリプトがエスケープされずに含まれる");
  }
  if (raw) {
    // JSON 応答に生のスクリプトがあるだけでは、描画側の扱いが分からない
    return inconclusive(t, "T4", "JSON応答に生のスクリプトを含む。描画側のエスケープはブラウザで確認が必要");
  }
  judge("T4", false, "スクリプトはエスケープされている");
});

test("T5 OIDCのコールバックで state を改ざんすると、ログインできない", async (t) => {
  if (loginSetupError) return inconclusive(t, "T5", `ログイン初期化失敗: ${loginSetupError}`);
  if (!adapter.oidc || !adapter.idp) {
    return inconclusive(t, "T5", "adapter.json に oidc / idp の設定がない");
  }

  const good = await authorizeOnce();
  if (!good) return inconclusive(t, "T5", "対照失敗: ログイン開始からIdPへのリダイレクトを取得できない");
  if (!(await loginWith(good, good.callback))) {
    return inconclusive(t, "T5", "対照失敗: 改ざんのないコールバックでログインできない");
  }

  const attack = await authorizeOnce();
  if (!attack) return inconclusive(t, "T5", "対照失敗: 2回目のログイン開始に失敗");
  const tampered = new URL(attack.callback);
  tampered.searchParams.set("state", `${tampered.searchParams.get("state")}-tampered`);
  const loggedIn = await loginWith(attack, tampered);
  judge("T5", loggedIn, loggedIn ? "state を書き換えたコールバックでログインが成立" : "state を書き換えたコールバックは拒否された");
});

test("T7 SQL特殊文字を含む投稿で、他人の非公開投稿が見えず、サーバーエラーにならない", async (t) => {
  if (loginSetupError) return inconclusive(t, "T7", `ログイン初期化失敗: ${loginSetupError}`);
  const privateSecret = `T7P-${nonce}`;
  const privatePost = await createPrivatePost(privateSecret);
  if (!isSuccess(privatePost)) {
    return inconclusive(t, "T7", `対照失敗: 非公開投稿の作成 (status ${privatePost.status})`);
  }
  const own = await client.call("timeline", { as: "alice" });
  if (!isSuccess(own) || !own.text.includes(privateSecret)) {
    return inconclusive(t, "T7", `対照失敗: 作者が自分の非公開投稿を見られない (status ${own.status})`);
  }

  const injection = `' OR '1'='1 ${nonce}`;
  const attempt = await client.call("createPost", { as: "alice", vars: { text: injection, visibility: adapter.visibility.public } });
  const sqlHint = /sql|syntax/i.test(attempt.text) ? "（SQLエラーの痕跡）" : "";
  const serverError = attempt.status >= 500;

  const bobTimeline = await client.call("timeline", { as: "bob" });
  const leaked = isSuccess(bobTimeline) && bobTimeline.text.includes(privateSecret);
  judge(
    "T7",
    serverError || leaked,
    `投稿 ${attempt.status}${sqlHint} / 他人のタイムラインに非公開投稿 ${leaked ? "が見える" : "は見えない"}`,
  );
});

test("T8 別サイトからのフォーム送信（CSRF）で投稿が保存されない", async (t) => {
  if (loginSetupError) return inconclusive(t, "T8", `ログイン初期化失敗: ${loginSetupError}`);
  // 対照: 同じ送信元（アプリ自身）からの投稿は保存される
  const control = `T8-control-${nonce}`;
  const ctl = await client.call("createPost", { as: "alice", vars: { text: control, visibility: adapter.visibility.public } });
  const ctlView = await client.call("timeline", { as: "alice" });
  if (!isSuccess(ctl) || !isSuccess(ctlView) || !ctlView.text.includes(control)) {
    return inconclusive(t, "T8", `対照失敗: 同じ送信元からの投稿が保存されない (post ${ctl.status})`);
  }

  // 攻撃: 別サイト（Origin が違う）から、alice のCookieで投稿を送る
  // 注: ブラウザの SameSite 制御は再現できない。サーバーが送信元を検査するかだけを見る
  const marker = `T8-${nonce}`;
  const attack = await client.call("createPost", {
    as: "alice",
    origin: "http://evil.example",
    dropCsrf: true,
    vars: { text: marker, visibility: adapter.visibility.public },
  });
  const view = await client.call("timeline", { as: "alice" });
  judge("T8", isSuccess(view) && view.text.includes(marker), `別サイトからの投稿 ${attack.status}`);
});

// OIDC の1回のログイン試行。開始 → 模擬IdPで認可 → コールバックURL を得る
async function authorizeOnce() {
  const start = await client.call("oidcStart");
  if (start.status < 300 || start.status >= 400 || !start.location) return null;
  // 生成アプリの発行者URLは、コンテナから見たホスト名になることがある。ホスト側からはローカルのURLで届かせる
  const authUrl = new URL(start.location);
  if (adapter.idp?.localIssuer) {
    const local = new URL(adapter.idp.localIssuer);
    authUrl.protocol = local.protocol;
    authUrl.host = local.host;
  }
  const idpRes = await fetch(authUrl, { redirect: "manual" });
  const back = idpRes.headers.get("location");
  if (!back) return null;
  return { cookie: start.setCookie, callback: new URL(back) };
}

// 開始時の Cookie と、改変する可能性のあるコールバックURLで、ログイン後にユーザーとして振る舞えるか
async function loginWith(flow, callback) {
  const res = await client.call("oidcCallback", { cookie: flow.cookie, vars: { query: callback.search } });
  if (!res.setCookie) return false;
  const me = await client.call("whoami", { cookie: res.setCookie });
  return isSuccess(me) && me.text.includes(adapter.oidc.loggedInMarker);
}
