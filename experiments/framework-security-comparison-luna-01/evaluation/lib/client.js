// 生成アプリに対するブラックボックスのHTTPクライアント。
// アプリごとの URL・リクエスト形式は adapter.json に書き、攻撃の内容と判定は共通化する。
//
// op の種類:
//   - JSON API: { method, path, body?, idField? }
//   - フォーム送信: { kind: "form", page, match, fields, idPattern? }
//     page のHTMLから match を含むフォームを探し、hidden 欄を引き継いで fields を送る。
//     Server Actions（Next.js のフォーム）もこの方式で扱える。

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export async function loadAdapter(path) {
  const adapter = JSON.parse(await readFile(path, "utf8"));
  for (const key of ["baseUrl", "sessions", "ops", "visibility"]) {
    if (!adapter[key]) throw new Error(`adapter.json に ${key} がありません`);
  }
  // "oidc" のときは、テスト開始時に模擬IdPでログインしてCookieを得る
  if (adapter.sessions !== "oidc") {
    for (const role of ["alice", "bob"]) {
      if (!adapter.sessions[role]) throw new Error(`sessions.${role} がありません`);
    }
  }
  return adapter;
}

// "{{name}}" を変数で置き換える。文字列全体が1つの変数なら、配列やオブジェクトもそのまま渡す。
function render(value, vars) {
  if (typeof value === "string") {
    const whole = value.match(/^\{\{(\w+)\}\}$/);
    if (whole) return vars[whole[1]];
    return value.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? ""));
  }
  if (Array.isArray(value)) return value.map((item) => render(item, vars));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, render(v, vars)]));
  }
  return value;
}

const decodeEntities = (s) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

// 2xx と 3xx（フォーム送信後のリダイレクト）を成功とみなす
export const isSuccess = (r) => r.status >= 200 && r.status < 400;

function findForm(html, match) {
  for (const chunk of html.split(/<form\b/i).slice(1)) {
    const form = chunk.split(/<\/form>/i)[0];
    if (form.includes(match)) return form;
  }
  return null;
}

// 表示名から、選択肢（option）またはラベルで囲まれたチェックボックスの value を探す
function optionValue(form, label) {
  for (const tag of form.match(/<option\b[^>]*>[\s\S]*?<\/option>/gi) ?? []) {
    const text = tag.replace(/<[^>]*>/g, "").trim();
    if (text === label) return decodeEntities(/value="([^"]*)"/i.exec(tag)?.[1] ?? "");
  }
  for (const block of form.match(/<label\b[\s\S]*?<\/label>/gi) ?? []) {
    const text = block.replace(/<[^>]*>/g, "").trim();
    if (text === label) return decodeEntities(/value="([^"]*)"/i.exec(block)?.[1] ?? "");
  }
  return undefined;
}

function hiddenInputs(form) {
  const pairs = [];
  for (const tag of form.match(/<input\b[^>]*>/gi) ?? []) {
    if (!/type="hidden"/i.test(tag)) continue;
    const name = /name="([^"]*)"/i.exec(tag)?.[1];
    const value = /value="([^"]*)"/i.exec(tag)?.[1] ?? "";
    if (name) pairs.push([decodeEntities(name), decodeEntities(value)]);
  }
  return pairs;
}

export function createClient(adapter) {
  const cookieFor = (role) => (role ? adapter.sessions[role] : null);
  const origin = new URL(adapter.baseUrl).origin;

  async function callJson(op, { cookie, vars, origin: sentOrigin }) {
    const headers = { accept: "application/json, text/html;q=0.9", ...(op.headers ?? {}) };
    if (cookie) headers.cookie = cookie;
    if (sentOrigin ?? op.origin) headers.origin = sentOrigin ?? op.origin;
    let body;
    if (op.body) {
      const data = render(op.body, vars);
      if (op.kind === "serverFn") {
        if (!adapter.serovalPath) throw new Error("TanStack serverFn adapter requires serovalPath");
        const { toJSONAsync } = await import(pathToFileURL(adapter.serovalPath));
        body = JSON.stringify(await toJSONAsync(data, { plugins: [] }));
      } else {
        body = JSON.stringify(data);
      }
      headers["content-type"] = "application/json";
    }
    return fetch(new URL(render(op.path, vars), adapter.baseUrl), {
      method: op.method,
      headers,
      body,
      redirect: "manual",
    });
  }

  // csrfFrom: { as, page } … CSRF 用の隠し欄を、そのユーザーのページから取る（攻撃者は自分のトークンしか持てない）
  // dropCsrf: true … CSRF 用の隠し欄を外して送る（被害者のトークンを持たない攻撃者）
  async function callForm(op, { cookie, formCookie, vars, origin: sentOrigin, csrfFrom, dropCsrf }) {
    const pagePath = render(op.page, vars);
    const pageUrl = new URL(pagePath, adapter.baseUrl);
    const page = await fetch(pageUrl, { headers: formCookie ? { cookie: formCookie } : {}, redirect: "manual" });
    const html = await page.text();
    const form = findForm(html, render(op.match, vars));
    if (!form) {
      return { status: 0, location: null, setCookie: "", contentType: "", text: "", json: null, id: undefined,
        error: `フォームが見つからない（${pagePath}, page ${page.status}）` };
    }

    // 欄の組を作る（値に配列や選択肢の指定があれば展開する）
    // 指定した欄は、同じ名前の隠し欄より優先する（隠し欄の既定値が先に送られないように）
    const fieldValues = render(op.fields ?? {}, vars);
    let pairs = hiddenInputs(form).filter(([name]) => !(name in fieldValues));
    if (dropCsrf) pairs = pairs.filter(([name]) => !/csrf/i.test(name));
    if (csrfFrom) {
      const tokenPage = await fetch(new URL(render(csrfFrom.page, vars), adapter.baseUrl), { headers: { cookie: cookieFor(csrfFrom.as) } }).then((r) => r.text());
      const tokenForm = tokenPage.split(/<form\b/i).slice(1).map((chunk) => chunk.split(/<\/form>/i)[0]).find((chunk) => /name="[^"]*csrf[^"]*"/i.test(chunk)) ?? "";
      const tokens = new Map(hiddenInputs(tokenForm).filter(([name]) => /csrf/i.test(name)));
      pairs = pairs.map(([name, value]) => (tokens.has(name) ? [name, tokens.get(name)] : [name, value]));
    }
    for (const [name, value] of Object.entries(fieldValues)) {
      // {option: 表示名 または 表示名の配列} は、選択肢の value に読み替える
      const resolved = value && typeof value === "object" && "option" in value
        ? (Array.isArray(value.option) ? value.option.map((l) => optionValue(form, l)) : optionValue(form, value.option))
        : value;
      for (const v of Array.isArray(resolved) ? resolved : [resolved]) {
        if (v !== undefined) pairs.push([name, String(v)]);
      }
    }
    // Next.js の Server Actions は隠し欄 $ACTION_ で見分け、multipart で送る。通常のフォームは urlencoded で送る
    const isNextAction = pairs.some(([name]) => name.startsWith("$ACTION"));
    const data = isNextAction ? new FormData() : new URLSearchParams();
    for (const [name, value] of pairs) data.append(name, value);

    const action = /action="([^"]*)"/i.exec(form)?.[1];
    const target = action && action.startsWith("/") ? new URL(decodeEntities(action), origin) : pageUrl;
    const headers = { origin: sentOrigin ?? origin };
    if (cookie) headers.cookie = cookie;
    return fetch(target, { method: "POST", headers, body: data, redirect: "manual" }).then((res) => res.text().then((text) => ({ res, text })));
  }

  // as: 送信者, formAs: フォームを読むユーザー（省略時は as）
  async function call(opName, { as = null, cookie = null, formAs = null, origin: sentOrigin = null, csrfFrom = null, dropCsrf = false, vars = {} } = {}) {
    const op = adapter.ops[opName];
    if (!op) throw new Error(`adapter.json に op「${opName}」がありません`);
    const sendCookie = cookie ?? cookieFor(as);
    if (!sendCookie && as) throw new Error(`session ${as} がありません`);

    if (op.kind === "form") {
      const formCookie = cookie ?? cookieFor(formAs ?? as);
      const empty = (error) => ({ status: 0, location: null, setCookie: "", contentType: "", text: "", json: null, id: undefined, error });
      let outcome;
      try {
        outcome = await callForm(op, { cookie: sendCookie, formCookie, vars, origin: sentOrigin, csrfFrom, dropCsrf });
      } catch (e) {
        return empty(String(e));
      }
      if (outcome.error) return empty(outcome.error);
      const { res, text } = outcome;
      const location = res.headers.get("location");
      const idMatch = op.idPattern && location ? new RegExp(op.idPattern).exec(location) : null;
      return {
        status: res.status,
        location,
        setCookie: res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "),
        contentType: res.headers.get("content-type") ?? "",
        text,
        json: null,
        id: idMatch ? idMatch[1] : undefined,
      };
    }

    const res = await callJson(op, { cookie: sendCookie, vars, origin: sentOrigin });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
      if (op.kind === "serverFn" && adapter.serovalPath) {
        const { fromCrossJSON } = await import(pathToFileURL(adapter.serovalPath));
        json = fromCrossJSON(json, { plugins: [] });
      }
    } catch {
      // HTML や空の応答は json を null のままにする
    }
    return {
      status: res.status,
      location: res.headers.get("location"),
      // 応答が発行した Cookie を「name=value; name=value」の形にまとめる
      setCookie: res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "),
      contentType: res.headers.get("content-type") ?? "",
      text,
      json,
      id: op.idField && json
        ? (op.kind === "serverFn" && (typeof json === "number" || typeof json === "string") ? json : json[op.idField])
        : undefined,
    };
  }

  return { call, hasOp: (name) => Boolean(adapter.ops[name]) };
}
