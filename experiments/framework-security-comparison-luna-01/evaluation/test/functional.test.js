// 独立した正常系受け入れテスト。脆弱性の判定は行わない。
// 実行: ADAPTER=../runs/<ID>/adapter.json npm run test:functional

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { loadAdapter, createClient, isSuccess } from "../lib/client.js";
import { startMockIdp } from "../lib/mockIdp.js";

const adapter = await loadAdapter(process.env.ADAPTER ?? new URL("../adapter.json", import.meta.url).pathname);
const client = createClient(adapter);
const nonce = Date.now().toString(36);
const records = [];
let startupPassed = false;
const idpLocal = adapter.idp?.localIssuer ?? adapter.idp?.issuer;
const idp = !adapter.idp ? null : adapter.idp.external
  ? { setSub: async (sub) => (await fetch(`${idpLocal}/__set-sub?sub=${sub}`)).ok, close: async () => {} }
  : await startMockIdp(adapter.idp);

function record(id, result, detail, extra = {}) {
  records.push({ id, result, detail, ...extra, at: new Date().toISOString() });
}

async function authorizeOnce() {
  const start = await client.call("oidcStart");
  if (start.status < 300 || start.status >= 400 || !start.location) throw new Error(`login start HTTP ${start.status}; ${start.text.slice(0,300)}`);
  const authUrl = new URL(start.location);
  if (adapter.idp?.localIssuer) {
    const local = new URL(adapter.idp.localIssuer);
    authUrl.protocol = local.protocol;
    authUrl.host = local.host;
  }
  const idpRes = await fetch(authUrl, { redirect: "manual" });
  const back = idpRes.headers.get("location");
  return back ? { cookie: start.setCookie, callback: new URL(back) } : null;
}

async function loginAs(role) {
  if (!idp) throw new Error("OIDC adapter requires idp configuration");
  await idp.setSub(role);
  const flow = await authorizeOnce();
  if (!flow) throw new Error(`${role} のログイン開始に失敗`);
  const callback = await client.call("oidcCallback", { cookie: flow.cookie, vars: { query: flow.callback.search } });
  if (!callback.setCookie) throw new Error(`${role} のログインでセッションが発行されない (${callback.status})`);
  const who = await client.call("whoami", { cookie: callback.setCookie });
  if (!isSuccess(who) || !who.text.toLowerCase().includes(role.toLowerCase())) {
    const sessionPair = callback.setCookie.split("; ").find((part) => part.startsWith("quietline_session="));
    let claims = "no session cookie";
    try { claims = JSON.stringify(JSON.parse(Buffer.from(sessionPair.split("=")[1].split(".")[1], "base64url").toString())); } catch {}
    throw new Error(`${role} として識別されない (callback ${callback.status}; whoami ${who.status}; ${who.text.slice(0,300)}; claims=${claims})`);
  }
  return callback.setCookie;
}

let loginSetupError = null;
if (adapter.sessions === "oidc") {
  try {
    adapter.sessions = { alice: await loginAs("alice"), bob: await loginAs("bob") };
  } catch (error) {
    loginSetupError = String(error);
    record("F1", "fail", `login setup failed: ${loginSetupError}`);
    // Keep the suite alive so F0 and diagnostic results are still written.
    adapter.sessions = { alice: "", bob: "" };
  }
}

after(async () => {
  const dir = new URL("../results/", import.meta.url);
  await mkdir(dir, { recursive: true });
  const file = new URL(`functional-${new Date().toISOString().replace(/[:.]/g, "-")}-${adapter.name ?? "unnamed"}.json`, dir);
  await writeFile(file, JSON.stringify({ adapter: adapter.name ?? "unnamed", records }, null, 2));
  console.log(`機能テスト結果を保存: ${file.pathname}`);
  if (idp) await idp.close();
});

test("F0 起動とホーム画面", async () => {
  const res = await fetch(adapter.baseUrl, { redirect: "manual" });
  const text = await res.text();
  const ok = res.status >= 200 && res.status < 300 && !/internal server error|application error/i.test(text);
  startupPassed = ok;
  record("F0", ok ? "pass" : "fail", `home HTTP ${res.status}`);
  assert.equal(ok, true, `ホーム画面が利用できない (HTTP ${res.status})`);
});

test("F1 模擬IdPでログインし、ログアウト後は未認証になる", async () => {
  if (!startupPassed) {
    record("F1", "not_evaluable", "F0 startup gate failed");
    return;
  }
  if (!idp || !adapter.ops.oidcLogout || !adapter.oidc?.loggedOutMarker) {
    record("F1", "not_evaluable", "OIDC login/logout adapter is incomplete");
    return;
  }
  if (loginSetupError) assert.fail(`OIDC login setup failed: ${loginSetupError}`);
  const cookie = await loginAs("alice");
  const out = await client.call("oidcLogout", { cookie });
  const loggedOut = await client.call("whoami", { cookie: out.setCookie || cookie });
  const afterLogout = adapter.oidc.loggedOutJsonPath
    ? adapter.oidc.loggedOutJsonPath.split(".").reduce((value, key) => value?.[key], loggedOut.json) == null
    : loggedOut.text.includes(adapter.oidc.loggedOutMarker);
  const pass = isSuccess(out) && isSuccess(loggedOut) && afterLogout;
  record("F1", pass ? "pass" : "fail", `logout HTTP ${out.status}; post-logout identity response HTTP ${loggedOut.status}`);
  assert.equal(pass, true, "ログアウト後もログイン状態が残るか、ログアウトを確認できない");
});

test("F2 公開投稿が作成され、AliceとBobのタイムラインに現れる", async (t) => {
  if (!startupPassed) { record("F2", "not_evaluable", "F0 startup gate failed"); return t.skip("startup gate failed"); }
  if (loginSetupError) { record("F2", "not_evaluable", `login setup failed: ${loginSetupError}`); return t.skip("login setup failed"); }
  const marker = `F2-${nonce}`;
  const posted = await client.call("createPost", { as: "alice", vars: { text: marker, visibility: adapter.visibility.public } });
  const alice = await client.call("timeline", { as: "alice" });
  const bob = await client.call("timeline", { as: "bob" });
  const pass = isSuccess(posted) && isSuccess(alice) && isSuccess(bob) && alice.text.includes(marker) && bob.text.includes(marker);
  record("F2", pass ? "pass" : "fail", `create ${posted.status}; alice timeline ${alice.status}; bob timeline ${bob.status}`, { marker });
  assert.equal(pass, true, "公開投稿の作成・共有表示に失敗");
});

test("F3 非公開投稿を作成し、作者のタイムラインから確認できる", async (t) => {
  if (!startupPassed) { record("F3", "not_evaluable", "F0 startup gate failed"); return t.skip("startup gate failed"); }
  if (loginSetupError) { record("F3", "not_evaluable", `login setup failed: ${loginSetupError}`); return t.skip("login setup failed"); }
  const marker = `F3-${nonce}`;
  const posted = await client.call("createPost", { as: "alice", vars: { text: marker, visibility: adapter.visibility.private } });
  const own = await client.call("timeline", { as: "alice" });
  const pass = isSuccess(posted) && isSuccess(own) && own.text.includes(marker);
  record("F3", pass ? "pass" : "fail", `create ${posted.status}; owner timeline ${own.status}`, { marker });
  assert.equal(pass, true, "本人による非公開投稿の作成・取得に失敗");
});

test("F4 DMグループのメンバーがメッセージを送受信できる", async (t) => {
  if (!startupPassed) { record("F4", "not_evaluable", "F0 startup gate failed"); return t.skip("startup gate failed"); }
  if (loginSetupError) { record("F4", "not_evaluable", `login setup failed: ${loginSetupError}`); return t.skip("login setup failed"); }
  const group = await client.call("createGroup", { as: "alice", vars: { name: `functional-${nonce}`, members: client.hasOp("addMember") ? [] : ["bob"] } });
  if (!isSuccess(group) || group.id === undefined) {
    record("F4", "fail", `group creation HTTP ${group.status}`);
    assert.fail(`DMグループの作成に失敗 (id=${group.id}; json=${JSON.stringify(group.json)}; body=${group.text.slice(0,500)})`);
  }
  if (client.hasOp("addMember")) {
    const add = await client.call("addMember", { as: "alice", vars: { id: group.id, member: "bob", name: "Bob" } });
    if (!isSuccess(add)) {
      record("F4", "fail", `member addition HTTP ${add.status}`);
      assert.fail("グループメンバーの追加に失敗");
    }
  }
  const marker = `F4-${nonce}`;
  const sent = await client.call("postGroupMessage", { as: "alice", vars: { id: group.id, text: marker } });
  const replyMarker = `F4-reply-${nonce}`;
  const reply = await client.call("postGroupMessage", { as: "bob", vars: { id: group.id, text: replyMarker } });
  const alice = await client.call("listGroupMessages", { as: "alice", vars: { id: group.id } });
  const bob = await client.call("listGroupMessages", { as: "bob", vars: { id: group.id } });
  const pass = isSuccess(sent) && isSuccess(reply) && isSuccess(alice) && isSuccess(bob)
    && alice.text.includes(marker) && alice.text.includes(replyMarker)
    && bob.text.includes(marker) && bob.text.includes(replyMarker);
  record("F4", pass ? "pass" : "fail", `Alice send ${sent.status}; Bob send ${reply.status}; Alice read ${alice.status}; Bob read ${bob.status}`, { groupId: group.id, marker, replyMarker });
  assert.equal(pass, true, "グループメンバーのメッセージ送受信に失敗");
});

test("F6 再起動後も前回の投稿とDMが残る", async (t) => {
  if (!startupPassed) { record("F6", "not_evaluable", "F0 startup gate failed"); return t.skip("startup gate failed"); }
  if (!process.env.PERSISTENCE_SOURCE) { record("F6", "not_evaluable", "requires a fresh process restart"); return t.skip("run after restart with PERSISTENCE_SOURCE"); }
  if (loginSetupError) { record("F6", "not_evaluable", `login setup failed: ${loginSetupError}`); return t.skip("login setup failed"); }
  const previous = JSON.parse(await readFile(process.env.PERSISTENCE_SOURCE, "utf8"));
  const pub = previous.records.find((r) => r.id === "F2");
  const priv = previous.records.find((r) => r.id === "F3");
  const dm = previous.records.find((r) => r.id === "F4");
  if (!pub?.marker || !priv?.marker || dm?.groupId === undefined || !dm.marker || !dm.replyMarker) {
    record("F6", "not_evaluable", "prior functional run lacks persistence markers"); return t.skip("prior functional markers missing");
  }
  const alice = await client.call("timeline", { as: "alice" });
  const bob = await client.call("timeline", { as: "bob" });
  const groupAlice = await client.call("listGroupMessages", { as: "alice", vars: { id: dm.groupId } });
  const groupBob = await client.call("listGroupMessages", { as: "bob", vars: { id: dm.groupId } });
  const pass = isSuccess(alice) && isSuccess(bob) && isSuccess(groupAlice) && isSuccess(groupBob)
    && alice.text.includes(pub.marker) && bob.text.includes(pub.marker) && alice.text.includes(priv.marker)
    && !bob.text.includes(priv.marker) && groupAlice.text.includes(dm.marker) && groupAlice.text.includes(dm.replyMarker)
    && groupBob.text.includes(dm.marker) && groupBob.text.includes(dm.replyMarker);
  record("F6", pass ? "pass" : "fail", `restart read: Alice ${alice.status}, Bob ${bob.status}, group ${groupAlice.status}/${groupBob.status}`);
  assert.equal(pass, true, "再起動後の公開・非公開投稿またはDMの永続化が不正");
});

test("F5 投稿本文の近くに作者と日時が画面表示される", async (t) => {
  if (!startupPassed) { record("F5", "not_evaluable", "F0 startup gate failed"); return t.skip("startup gate failed"); }
  if (loginSetupError) { record("F5", "not_evaluable", `login setup failed: ${loginSetupError}`); return t.skip("login setup failed"); }
  const marker = `F5-${nonce}`;
  const post = await client.call("createPost", { as: "alice", vars: { text: marker, visibility: adapter.visibility.public } });
  if (!isSuccess(post)) {
    record("F5", "fail", `public post HTTP ${post.status}`);
    assert.fail("画面確認用の投稿を作成できない");
  }
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const cookies = adapter.sessions.alice.split(";").map((v) => v.trim()).filter(Boolean).map((pair) => {
      const i = pair.indexOf("=");
      return { name: pair.slice(0, i), value: pair.slice(i + 1), url: adapter.baseUrl };
    });
    await context.addCookies(cookies);
    const page = await context.newPage();
    await page.goto(adapter.baseUrl, { waitUntil: "networkidle" });
    const body = await page.locator("body").innerText();
    const at = body.indexOf(marker);
    if (at < 0) {
      record("F5", "fail", "created post did not appear in the browser UI");
      assert.fail("投稿が画面に表示されない");
    }
    const nearby = body.slice(Math.max(0, at - 180), at + marker.length + 180);
    const author = /alice/i.test(nearby);
    const timestamp = /20\d{2}|\d{1,2}月\d{1,2}日|\d{1,2}[/:]\d{2}/.test(nearby);
    const pass = author && timestamp;
    record("F5", pass ? "pass" : "fail", `author visible=${author}; timestamp visible=${timestamp}; context=${nearby}`);
    assert.equal(pass, true, "投稿本文の近くに作者名と日時の両方が表示されない");
  } catch (error) {
    if (error?.code === "ENOENT" || /executable doesn't exist|browserType\.launch/i.test(String(error))) {
      record("F5", "not_evaluable", `Playwright browser unavailable: ${String(error)}`);
      t.skip("Playwright browser is unavailable");
    } else throw error;
  } finally {
    if (browser) await browser.close();
  }
});
