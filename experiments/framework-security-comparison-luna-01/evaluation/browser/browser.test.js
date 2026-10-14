// マイクロSNSのブラウザ判定（B1, B2, B4, B8）。実際の Chromium で操作し、画面に出た内容で判定する。
// HTTP版（test/security.test.js）と同じく、判定は「候補」まで。失敗は人の再現確認が必要。
// 対照（正当な操作が画面で成功すること）が満たされないときは inconclusive とする。
//
// 実行: ADAPTER=../runs/<ID>/adapter.json npm run test:browser
// adapter.json には browser の設定が必要（画面の場所と入力欄のセレクタ）。

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { loadAdapter } from "../lib/client.js";

const adapter = await loadAdapter(process.env.ADAPTER ?? new URL("../adapter.json", import.meta.url).pathname);
const b = adapter.browser;
if (!b) throw new Error("adapter.json に browser の設定がありません");
const base = adapter.baseUrl;
const local = adapter.idp.localIssuer;
const nonce = Date.now().toString(36);
const records = [];
const browser = await chromium.launch({ headless: true });

function record(id, status, detail) {
  records.push({ id, status, detail, at: new Date().toISOString() });
}
function inconclusive(t, id, reason) {
  record(id, "inconclusive", reason);
  t.skip(reason);
}
function judge(id, leaked, detail) {
  record(id, leaked ? "candidate" : "defended", detail);
  assert.equal(leaked, false, `${id} 脆弱性の候補: ${detail}`);
}

after(async () => {
  await browser.close();
  const dir = new URL("../results/", import.meta.url);
  await mkdir(dir, { recursive: true });
  const file = new URL(`browser-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, dir);
  await writeFile(file, JSON.stringify({ adapter: adapter.name ?? "unnamed", records }, null, 2));
  console.log(`結果を保存: ${file.pathname}`);
});

// 模擬IdPの発行者URL（host.docker.internal）は、ホスト側のブラウザから 127.0.0.1 に読み替える
async function newContext() {
  const context = await browser.newContext();
  await context.route(/host\.docker\.internal:4500/, (route) =>
    route.continue({ url: route.request().url().replace("host.docker.internal", "127.0.0.1") }),
  );
  return context;
}

// 模擬IdP のユーザーを切り替え、画面からログインする
async function login(role) {
  await fetch(`${local}/__set-sub?sub=${role}`);
  const context = await newContext();
  const page = await context.newPage();
  await page.goto(new URL(b.login.path, base).href);
  await page.click(b.login.click);
  await page.waitForSelector(`text=${adapter.oidc.loggedInMarker}`, { timeout: 30000 });
  return { context, page };
}

// 指定の画面で、投稿フォームに入力して送る
// 非公開投稿は別ページ（privatePath）から送る。公開投稿はタイムラインから送る
async function postAs(page, text, isPrivate = false) {
  const path = isPrivate && b.privatePath ? b.privatePath : b.timeline.path;
  await page.goto(new URL(path, base).href);
  await page.fill(b.postForm.text, text);
  await page.click(b.postForm.submit);
  await page.waitForLoadState("networkidle");
}

// グループを画面から作り、できたグループの ID を返す
async function createGroupAs(page, name) {
  await page.goto(new URL(b.groupCreate.path, base).href);
  await page.fill(b.groupCreate.name, name);
  await page.click(b.groupCreate.submit);
  await page.waitForURL(new RegExp(b.groupIdPattern), { timeout: 15000 });
  return new RegExp(b.groupIdPattern).exec(page.url())?.[1];
}

async function messageAs(page, groupId, text) {
  await page.goto(new URL(b.groupPath.replace("{id}", groupId), base).href);
  console.log("DEBUG messageAs", groupId, page.url(), (await page.content()).length);
  await page.fill(b.groupMessage.text, text);
  await page.click(b.groupMessage.submit);
  await page.waitForLoadState("networkidle");
}

test("B1 他人の非公開投稿が、ブラウザのタイムラインに出ない", async (t) => {
  const alice = await login("alice");
  const bob = await login("bob");
  const secret = `B1-${nonce}`;
  await postAs(alice.page, secret, true);
  await alice.page.goto(new URL(b.privatePath ?? b.timeline.path, base).href);
  if (!(await alice.page.content()).includes(secret)) {
    return inconclusive(t, "B1", "対照失敗: 作者が自分の非公開投稿を画面で見られない");
  }

  // 他人は、タイムラインと非公開ページのどちらにも出してはいけない
  for (const path of [b.timeline.path, b.privatePath ?? b.timeline.path]) {
    await bob.page.goto(new URL(path, base).href);
    if ((await bob.page.content()).includes(secret)) {
      judge("B1", true, `他人のブラウザ（${path}）に非公開投稿が出る`);
    }
  }
  judge("B1", false, "他人のブラウザには非公開投稿が出ない");
});

test("B2 非メンバーが、ブラウザでDMグループのメッセージを見られない", async (t) => {
  const alice = await login("alice");
  const bob = await login("bob");
  const groupId = await createGroupAs(alice.page, `B2-group-${nonce}`);
  if (!groupId) return inconclusive(t, "B2", "対照失敗: 画面からグループを作れない");
  const secret = `B2-${nonce}`;
  await messageAs(alice.page, groupId, secret);
  await alice.page.goto(new URL(b.groupPath.replace("{id}", groupId), base).href);
  if (!(await alice.page.content()).includes(secret)) {
    return inconclusive(t, "B2", "対照失敗: メンバーが画面でメッセージを確認できない");
  }

  const response = await bob.page.goto(new URL(b.groupPath.replace("{id}", groupId), base).href);
  judge("B2", (await bob.page.content()).includes(secret), `非メンバーの画面 ${response?.status()}`);
});

test("B4 投稿に埋めたスクリプトが、ブラウザで実行されない", async (t) => {
  const alice = await login("alice");
  const bob = await login("bob");
  const marker = `B4-${nonce}`;
  const flag = `__xss_${nonce}`;
  const payload = `${marker} <img src="x" onerror="window.${flag}=1">`;
  await postAs(alice.page, payload);

  await bob.page.goto(new URL(b.timeline.path, base).href);
  if (!(await bob.page.content()).includes(marker)) {
    return inconclusive(t, "B4", "対照失敗: 投稿が閲覧者の画面に出ない");
  }
  const executed = await bob.page.evaluate((f) => window[f] === 1, flag);
  judge("B4", executed, executed ? "埋め込んだスクリプトが実行された" : "スクリプトは実行されなかった");
});

test("B8 別サイトのページからの投稿が保存されない（ブラウザのCookie制御を含む）", async (t) => {
  if (!b.attackPost) return inconclusive(t, "B8", "adapter.json に attackPost の設定がない（Next.js の Server Actions は対象外）");
  const alice = await login("alice");
  const control = `B8-control-${nonce}`;
  await postAs(alice.page, control);
  await alice.page.goto(new URL(b.timeline.path, base).href);
  if (!(await alice.page.content()).includes(control)) {
    return inconclusive(t, "B8", "対照失敗: 同じサイトからの投稿が画面に出ない");
  }

  // 攻撃: 別サイト（evil.test）のページが、アプリへ自動送信するフォームを置く
  const marker = `B8-${nonce}`;
  const fields = { [b.attackPost.field]: marker, ...(b.attackPost.extra ?? {}) };
  const inputs = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${v}">`)
    .join("");
  const html = `<!doctype html><form id="f" method="post" action="${new URL(b.attackPost.path, base).href}">${inputs}</form><script>document.getElementById("f").submit()</script>`;
  await alice.context.route(/evil\.test/, (route) => route.fulfill({ contentType: "text/html", body: html }));
  await alice.page.goto("http://evil.test/attack").catch(() => {});
  await alice.page.waitForLoadState("networkidle").catch(() => {});

  await alice.page.goto(new URL(b.timeline.path, base).href);
  judge("B8", (await alice.page.content()).includes(marker), "別サイトのページからの投稿が保存された");
});
