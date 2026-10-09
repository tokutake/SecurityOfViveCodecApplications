'use strict';
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const state = { me: null, csrf: null, hasApiKey: false, models: [], oldestId: null };

  // ---------- 共通 ----------
  function flash(msg, isError = false) {
    const box = $('#flash');
    box.replaceChildren();
    if (!msg) return;
    const div = document.createElement('div');
    div.className = 'msg' + (isError ? ' error' : '');
    div.textContent = msg;
    box.append(div);
    clearTimeout(flash.t);
    flash.t = setTimeout(() => box.replaceChildren(), 6000);
  }

  async function api(method, path, body) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && state.csrf) headers['X-CSRF-Token'] = state.csrf;
    const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
    let data = {};
    try { data = await res.json(); } catch { /* empty */ }
    if (res.status === 401 && state.me && !path.endsWith('/login')) {
      setMe(null);
      throw new Error('セッションが切れました。再度ログインしてください');
    }
    if (!res.ok) throw new Error(data.error || `エラー (HTTP ${res.status})`);
    return data;
  }

  const cpLen = (s) => [...s].length;

  function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v; else e.setAttribute(k, v);
    }
    for (const c of children) if (c != null) e.append(c);
    return e;
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleString('ja-JP');
  }

  // ---------- 画面切替 ----------
  function show(view) {
    for (const v of ['auth', 'timeline', 'settings', 'admin']) $(`#view-${v}`).hidden = v !== view;
    for (const b of document.querySelectorAll('nav [data-view]')) b.classList.toggle('active', b.dataset.view === view);
    if (view === 'timeline') loadTimeline();
    if (view === 'settings') loadSettings();
    if (view === 'admin') loadUsers();
  }

  function setMe(data) {
    state.me = data && data.user ? data.user : null;
    state.csrf = state.me ? data.csrfToken : null;
    state.hasApiKey = !!(data && data.hasApiKey);
    $('#nav').hidden = !state.me;
    if (!state.me) { show('auth'); return; }
    $('#whoami').textContent = `${state.me.username}${state.me.role === 'admin' ? ' (管理者)' : ''}${state.me.suspended ? ' [停止中]' : ''}`;
    $('#nav-admin').hidden = state.me.role !== 'admin';
    $('#suspended-banner').hidden = !state.me.suspended;
    $('#post-form button[type=submit]').disabled = state.me.suspended;
    show('timeline');
  }

  // ---------- 認証 ----------
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      setMe(await api('POST', '/api/login', { username: f.username.value, password: f.password.value }));
      f.reset();
      flash('ログインしました');
    } catch (err) { flash(err.message, true); }
  });

  $('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      setMe(await api('POST', '/api/register', { username: f.username.value, password: f.password.value }));
      f.reset();
      flash('登録しました');
    } catch (err) { flash(err.message, true); }
  });

  $('#logout').addEventListener('click', async () => {
    try { await api('POST', '/api/logout'); } catch { /* ignore */ }
    setMe(null);
    flash('ログアウトしました');
  });

  for (const b of document.querySelectorAll('nav [data-view]')) b.addEventListener('click', () => show(b.dataset.view));

  // ---------- タイムライン ----------
  const postArea = $('#post-form textarea');
  function updateCount() {
    const n = cpLen(postArea.value);
    const c = $('#post-count');
    c.textContent = `${n} / 140`;
    c.classList.toggle('over', n > 140);
  }
  postArea.addEventListener('input', updateCount);

  $('#post-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const content = postArea.value;
    if (!content.trim()) return flash('投稿内容が空です', true);
    if (cpLen(content) > 140) return flash('投稿は140文字以内にしてください', true);
    try {
      await api('POST', '/api/posts', { content });
      postArea.value = '';
      updateCount();
      loadTimeline();
    } catch (err) { flash(err.message, true); }
  });

  $('#reload').addEventListener('click', () => loadTimeline());
  $('#more').addEventListener('click', () => loadTimeline(true));

  function renderPost(p) {
    const isLlm = p.authorType === 'llm';
    const meta = el('div', { class: 'meta' });
    if (isLlm) {
      meta.append(
        el('span', { class: 'name' }, p.llmName || '(削除済みLLM)'),
        el('span', { class: 'badge' }, 'LLM'),
        el('span', { class: 'badge model', title: '使用モデル' }, `モデル: ${p.model}`),
        el('span', {}, `所有者: @${p.username}`),
      );
    } else {
      meta.append(el('span', { class: 'name' }, `@${p.username}`), el('span', { class: 'badge human' }, '人間'));
    }
    meta.append(el('time', { datetime: p.createdAt }, fmtDate(p.createdAt)));
    const li = el('li', { class: 'post' + (isLlm ? ' llm' : '') }, meta, el('div', { class: 'content' }, p.content));
    if (p.canDelete) {
      const del = el('button', { type: 'button', class: 'danger' }, '削除');
      del.addEventListener('click', async () => {
        if (!confirm('この投稿を削除しますか？')) return;
        try { await api('DELETE', `/api/posts/${p.id}`); li.remove(); flash('投稿を削除しました'); } catch (err) { flash(err.message, true); }
      });
      li.append(el('div', { class: 'row' }, el('span'), del));
    }
    return li;
  }

  async function loadTimeline(more = false) {
    try {
      const qs = more && state.oldestId ? `?before=${state.oldestId}` : '';
      const { posts } = await api('GET', `/api/posts${qs}`);
      const list = $('#timeline');
      if (!more) list.replaceChildren();
      for (const p of posts) list.append(renderPost(p));
      if (posts.length) state.oldestId = posts[posts.length - 1].id;
      $('#more').hidden = posts.length < 50;
      if (!more && !posts.length) list.append(el('li', {}, 'まだ投稿がありません'));
    } catch (err) { flash(err.message, true); }
  }

  // ---------- 設定 ----------
  function fillModels(select, current) {
    select.replaceChildren(...state.models.map((m) => el('option', { value: m }, m)));
    if (current) select.value = current;
  }

  function renderKeyStatus(info) {
    state.hasApiKey = info.registered;
    $('#key-status').textContent = info.registered ? `登録済み (更新: ${fmtDate(info.updatedAt)})` : '未登録';
    $('#key-delete').disabled = !info.registered;
  }

  async function loadSettings() {
    try {
      if (!state.models.length) state.models = (await api('GET', '/api/models')).models;
      fillModels($('#llm-create-form select'));
      renderKeyStatus(await api('GET', '/api/apikey'));
      const { accounts } = await api('GET', '/api/llm-accounts');
      const list = $('#llm-list');
      list.replaceChildren();
      if (!accounts.length) list.append(el('p', {}, 'まだLLMアカウントがありません'));
      for (const a of accounts) list.append(renderLlm(a));
    } catch (err) { flash(err.message, true); }
  }

  function llmBody(f) {
    return { displayName: f.displayName.value, model: f.model.value, prompt: f.prompt.value };
  }

  function renderLlm(a) {
    const f = $('#tpl-llm').content.firstElementChild.cloneNode(true);
    f.displayName.value = a.displayName;
    fillModels(f.model, a.model);
    f.prompt.value = a.prompt;
    f.prepend(el('h3', {}, `#${a.id} ${a.displayName}`));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('PUT', `/api/llm-accounts/${a.id}`, llmBody(f)); flash('設定を保存しました'); loadSettings(); } catch (err) { flash(err.message, true); }
    });
    const gen = $('.generate', f);
    gen.disabled = !!state.me.suspended;
    gen.addEventListener('click', async () => {
      gen.disabled = true;
      gen.textContent = '生成中…';
      try {
        const r = await api('POST', `/api/llm-accounts/${a.id}/generate`);
        flash(`投稿しました (${r.model}): ${r.content}`);
      } catch (err) { flash(err.message, true); }
      gen.disabled = !!state.me.suspended;
      gen.textContent = '投稿を生成';
    });
    $('.delete', f).addEventListener('click', async () => {
      if (!confirm(`LLMアカウント「${a.displayName}」を削除しますか？ (このアカウントの投稿も削除されます)`)) return;
      try { await api('DELETE', `/api/llm-accounts/${a.id}`); flash('削除しました'); loadSettings(); } catch (err) { flash(err.message, true); }
    });
    return f;
  }

  $('#key-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      renderKeyStatus(await api('PUT', '/api/apikey', { apiKey: f.apiKey.value }));
      f.reset();
      flash('APIキーを保存しました');
    } catch (err) { flash(err.message, true); }
  });

  $('#key-delete').addEventListener('click', async () => {
    if (!confirm('APIキーを削除しますか？')) return;
    try { renderKeyStatus(await api('DELETE', '/api/apikey')); flash('APIキーを削除しました'); } catch (err) { flash(err.message, true); }
  });

  $('#llm-create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('POST', '/api/llm-accounts', llmBody(f));
      f.reset();
      flash('LLMアカウントを作成しました');
      loadSettings();
    } catch (err) { flash(err.message, true); }
  });

  // ---------- 管理 ----------
  async function loadUsers() {
    try {
      const { users } = await api('GET', '/api/admin/users');
      const tbody = $('#user-table tbody');
      tbody.replaceChildren();
      for (const u of users) {
        const ops = el('td');
        if (u.role === 'user') {
          const b = el('button', { type: 'button', class: u.suspended ? '' : 'danger' }, u.suspended ? '停止解除' : '利用停止');
          b.addEventListener('click', async () => {
            const action = u.suspended ? 'unsuspend' : 'suspend';
            if (!confirm(`${u.username} を${u.suspended ? '停止解除' : '利用停止'}しますか？`)) return;
            try { await api('POST', `/api/admin/users/${u.id}/${action}`); loadUsers(); } catch (err) { flash(err.message, true); }
          });
          ops.append(b);
        }
        tbody.append(el('tr', {},
          el('td', {}, String(u.id)), el('td', {}, u.username),
          el('td', {}, u.role === 'admin' ? '管理者' : '一般'), el('td', {}, String(u.llmCount)),
          el('td', {}, u.suspended ? '停止中' : '有効'), ops));
      }
    } catch (err) { flash(err.message, true); }
  }

  // ---------- 起動 ----------
  api('GET', '/api/me').then(setMe).catch(() => setMe(null));
})();
