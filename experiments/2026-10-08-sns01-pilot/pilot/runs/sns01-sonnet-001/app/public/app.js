'use strict';
const $ = (id) => document.getElementById(id);
const app = $('app');
let me = null;
let models = [];

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else e[k] = v;
  }
  for (const c of kids.flat()) if (c != null) e.append(c);
  return e;
}

function say(text, ok = false) {
  const m = $('msg');
  m.textContent = text || '';
  m.className = ok ? 'ok' : '';
}

async function api(method, path, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(path, opt);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `エラー (${r.status})`);
  return data;
}

// 操作を実行し、失敗時はメッセージ表示
const act = (fn, okMsg) => async (...a) => {
  try { say(''); await fn(...a); if (okMsg) say(okMsg, true); } catch (e) { say(e.message); }
};

const fmt = (t) => new Date(t).toLocaleString('ja-JP');

function authView() {
  $('who').replaceChildren();
  const u = h('input', { id: 'u', autocomplete: 'username', maxLength: 20 });
  const p = h('input', { id: 'p', type: 'password', autocomplete: 'current-password', maxLength: 200 });
  const submit = (path) => act(async () => {
    const r = await api('POST', path, { username: u.value, password: p.value });
    me = r.user;
    await mainView();
  });
  app.replaceChildren(h('section', {},
    h('h2', {}, 'ログイン / 新規登録'),
    h('div', { class: 'row' }, h('label', {}, 'ユーザー名 ', u)),
    h('div', { class: 'row' }, h('label', {}, 'パスワード(8文字以上) ', p)),
    h('div', { class: 'row' },
      h('button', { id: 'login', onclick: submit('/api/login') }, 'ログイン'),
      h('button', { id: 'register', onclick: submit('/api/register') }, '新規登録'))));
}

async function mainView() {
  say('');
  models = (await api('GET', '/api/models')).models;
  $('who').replaceChildren(
    h('span', {}, `${me.username}`),
    me.isAdmin ? h('span', { class: 'badge' }, '管理者') : null,
    me.suspended ? h('span', { class: 'badge warn' }, '利用停止中') : null,
    ' ',
    h('button', { id: 'logout', onclick: act(async () => { await api('POST', '/api/logout'); me = null; authView(); }) }, 'ログアウト'));

  const timeline = h('div', { id: 'timeline' });
  const llmBox = h('div', { id: 'llms' });
  const keyBox = h('div', { id: 'keybox' });
  const adminBox = h('div', { id: 'admin' });

  const text = h('textarea', { id: 'postText', rows: 3 });
  const count = h('span', { class: 'count' }, '0/140');
  text.addEventListener('input', () => {
    const n = [...text.value.trim()].length;
    count.textContent = `${n}/140`;
    count.className = n > 140 ? 'count over' : 'count';
  });

  const loadTimeline = act(async () => {
    const { posts } = await api('GET', '/api/posts');
    timeline.replaceChildren(...posts.map(postView), posts.length ? null : h('p', {}, 'まだ投稿がありません'));
  });

  function postView(p) {
    const a = p.author;
    const canDelete = me.isAdmin || (a.kind === 'human' ? a.userId === me.id : a.ownerId === me.id);
    return h('div', { class: 'post', dataset: { id: p.id } },
      h('div', { class: 'meta' },
        h('strong', {}, a.name),
        a.kind === 'llm' ? h('span', { class: 'badge' }, `LLM: ${a.model}`) : null,
        a.kind === 'llm' ? ` (所有者: ${a.ownerName})` : null,
        ` ${fmt(p.createdAt)}`),
      h('div', { class: 'body' }, p.body),
      canDelete ? h('button', { class: 'del', onclick: act(async () => { await api('DELETE', `/api/posts/${p.id}`); await loadTimeline(); }, '削除しました') }, '削除') : null);
  }

  const loadKey = () => {
    const input = h('input', { id: 'keyInput', type: 'password', autocomplete: 'off', maxLength: 256, placeholder: 'sk-or-...' });
    keyBox.replaceChildren(
      h('div', {}, h('span', { id: 'keyStatus' }, me.hasApiKey ? '登録済み' : '未登録')),
      h('div', { class: 'row' }, input,
        h('button', { id: 'keySave', onclick: act(async () => {
          const r = await api('PUT', '/api/key', { key: input.value });
          me.hasApiKey = r.hasApiKey; loadKey();
        }, 'APIキーを保存しました') }, me.hasApiKey ? '更新' : '登録'),
        me.hasApiKey ? h('button', { id: 'keyDelete', onclick: act(async () => {
          const r = await api('DELETE', '/api/key'); me.hasApiKey = r.hasApiKey; loadKey();
        }, 'APIキーを削除しました') }, '削除') : null));
  };

  function llmForm(l) {
    const name = h('input', { value: l?.displayName || '', maxLength: 30, placeholder: '表示名' });
    const model = h('select', {}, models.map((m) => h('option', { value: m, selected: l?.model === m }, m)));
    const ins = h('textarea', { rows: 2, maxLength: 1000, placeholder: '投稿生成用の指示文', value: l?.instruction || '' });
    const save = act(async () => {
      const body = { displayName: name.value, model: model.value, instruction: ins.value };
      if (l) await api('PUT', `/api/llms/${l.id}`, body); else await api('POST', '/api/llms', body);
      await loadLlms();
    }, l ? '更新しました' : 'LLMアカウントを作成しました');
    const wrap = h('div', { class: l ? 'llm' : '' },
      h('div', { class: 'row' }, name, model), ins,
      h('div', { class: 'row' },
        h('button', { class: l ? 'llmSave' : 'llmCreate', onclick: save }, l ? '設定を更新' : '作成'),
        l ? h('button', { class: 'gen', onclick: act(async () => { await api('POST', `/api/llms/${l.id}/generate`); await loadTimeline(); }, '投稿を生成しました') }, '投稿を生成') : null));
    return wrap;
  }
  const loadLlms = act(async () => {
    const { llms } = await api('GET', '/api/llms');
    llmBox.replaceChildren(...llms.map(llmForm), h('h3', {}, '新規LLMアカウント'), llmForm(null));
  });

  const loadAdmin = act(async () => {
    const { users } = await api('GET', '/api/admin/users');
    adminBox.replaceChildren(...users.map((u) => h('div', { class: 'row', dataset: { user: u.username } },
      h('span', {}, u.username), u.isAdmin ? h('span', { class: 'badge' }, '管理者') : null,
      u.suspended ? h('span', { class: 'badge warn' }, '停止中') : null,
      u.isAdmin ? null : h('button', { class: u.suspended ? 'unsuspend' : 'suspend', onclick: act(async () => {
        await api('POST', `/api/admin/users/${u.id}/${u.suspended ? 'unsuspend' : 'suspend'}`); await loadAdmin();
      }, u.suspended ? '停止を解除しました' : '利用を停止しました') }, u.suspended ? '停止解除' : '利用停止'))));
  });

  app.replaceChildren(
    h('section', {}, h('h2', {}, '投稿'),
      me.suspended ? h('p', {}, '利用停止中のため投稿・生成はできません。') : null,
      text, h('div', { class: 'row' }, count,
        h('button', { id: 'postBtn', onclick: act(async () => {
          await api('POST', '/api/posts', { body: text.value }); text.value = ''; count.textContent = '0/140'; await loadTimeline();
        }, '投稿しました') }, '投稿'))),
    h('section', {}, h('h2', {}, 'タイムライン'), timeline),
    h('section', {}, h('h2', {}, 'OpenRouter APIキー'), keyBox),
    h('section', {}, h('h2', {}, 'LLMアカウント'), llmBox),
    me.isAdmin ? h('section', {}, h('h2', {}, '管理: ユーザー'), adminBox) : null);
  loadKey();
  await Promise.all([loadTimeline(), loadLlms(), me.isAdmin ? loadAdmin() : null]);
}

(async () => {
  try {
    me = (await api('GET', '/api/me')).user;
    if (me) await mainView(); else authView();
  } catch (e) { say(e.message); }
})();
