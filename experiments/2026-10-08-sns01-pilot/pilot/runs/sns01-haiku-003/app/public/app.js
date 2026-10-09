const MAX_POST_LENGTH = 140;

const $ = (selector) => document.querySelector(selector);
const models = [];
let me = null;

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function fmtTime(iso) {
  return new Date(iso).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' });
}

function codePointLength(text) {
  return [...text].length;
}

function flash(el, message, isError = false) {
  el.textContent = message;
  el.className = `flash ${isError ? 'error' : 'ok'}`;
  el.hidden = !message;
}

async function api(method, url, body) {
  const init = { method, headers: {} };
  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body ?? {});
  }
  const res = await fetch(url, init);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `通信に失敗しました (${res.status})`);
  return data;
}

function modelOptions(selected) {
  return models
    .map((m) => `<option value="${esc(m)}"${m === selected ? ' selected' : ''}>${esc(m)}</option>`)
    .join('');
}

function showAuth() {
  me = null;
  $('#app-view').hidden = true;
  $('#auth-view').hidden = false;
}

async function enterApp(user) {
  me = user;
  $('#auth-view').hidden = true;
  $('#app-view').hidden = false;
  $('#whoami').textContent = `${user.username}${user.role === 'admin' ? '（管理者）' : ''}`;
  $('#suspended-banner').hidden = !user.suspended;
  $('#admin-section').hidden = user.role !== 'admin';
  $('.model-select').innerHTML = modelOptions(models[0]);
  await Promise.all([loadTimeline(), loadKeyStatus(), loadAccounts(), user.role === 'admin' ? loadUsers() : null]);
}

// --- 認証 ---
function switchAuthTab(name) {
  const isLogin = name === 'login';
  $('#tab-login').classList.toggle('active', isLogin);
  $('#tab-register').classList.toggle('active', !isLogin);
  $('#login-form').hidden = !isLogin;
  $('#register-form').hidden = isLogin;
  flash($('#auth-flash'), '');
}

async function submitAuth(form, endpoint) {
  const data = Object.fromEntries(new FormData(form));
  try {
    const { user } = await api('POST', endpoint, data);
    form.reset();
    await enterApp(user);
  } catch (err) {
    flash($('#auth-flash'), err.message, true);
  }
}

// --- タイムライン ---
function renderPost(post) {
  const isLlm = post.authorType === 'llm';
  const badge = isLlm ? `<span class="badge llm">LLM · ${esc(post.modelId)}</span>` : '';
  const del = post.canDelete ? `<button type="button" class="danger small" data-delete="${post.id}">削除</button>` : '';
  return `
    <article class="post${isLlm ? ' is-llm' : ''}">
      <header>
        <strong>${esc(post.authorName)}</strong> ${badge}
        <time class="muted">${esc(fmtTime(post.createdAt))}</time>
      </header>
      <p class="body">${esc(post.body)}</p>
      <footer>${del}</footer>
    </article>`;
}

async function loadTimeline() {
  const { posts } = await api('GET', '/api/timeline');
  $('#timeline').innerHTML = posts.length
    ? posts.map(renderPost).join('')
    : '<p class="muted">まだ投稿がありません。</p>';
}

function updatePostCount() {
  const length = codePointLength($('#post-body').value);
  const counter = $('#post-count');
  counter.textContent = `${length}/${MAX_POST_LENGTH}`;
  counter.classList.toggle('over', length > MAX_POST_LENGTH);
  $('#post-submit').disabled = length === 0 || length > MAX_POST_LENGTH;
}

// --- APIキー ---
async function loadKeyStatus() {
  const status = await api('GET', '/api/me/api-key');
  $('#key-status').textContent = status.registered
    ? `登録済み（更新: ${fmtTime(status.updatedAt)}）。キーの内容は表示されません。`
    : '未登録です。';
  $('#key-delete').disabled = !status.registered;
}

// --- LLMアカウント ---
function renderAccount(account) {
  return `
    <form class="llm-item" data-id="${account.id}">
      <label>表示名<input name="displayName" maxlength="30" value="${esc(account.displayName)}" required /></label>
      <label>使用モデル<select name="modelId">${modelOptions(account.modelId)}</select></label>
      <label>指示文<textarea name="instruction" rows="3" maxlength="500" required>${esc(account.instruction)}</textarea></label>
      <div class="row">
        <button type="submit">設定を保存</button>
        <button type="button" class="secondary" data-generate="${account.id}">投稿を生成</button>
      </div>
    </form>`;
}

async function loadAccounts() {
  const { accounts } = await api('GET', '/api/llm-accounts');
  $('#llm-list').innerHTML = accounts.length
    ? accounts.map(renderAccount).join('')
    : '<p class="muted">LLMアカウントはまだありません。</p>';
}

// --- 管理者 ---
async function loadUsers() {
  const { users } = await api('GET', '/api/admin/users');
  const rows = users
    .map((u) => {
      let action = '<span class="muted">—</span>';
      if (u.role === 'user') {
        action = u.suspended
          ? `<button type="button" class="secondary small" data-suspend="${u.id}" data-value="false">停止解除</button>`
          : `<button type="button" class="danger small" data-suspend="${u.id}" data-value="true">利用停止</button>`;
      }
      const status = u.role === 'admin' ? '管理者' : u.suspended ? '<span class="badge stop">停止中</span>' : '有効';
      return `<tr><td>${esc(u.username)}</td><td>${status}</td><td>${action}</td></tr>`;
    })
    .join('');
  $('#admin-users').innerHTML = `<table><thead><tr><th>ユーザー</th><th>状態</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function wireEvents() {
  $('#tab-login').addEventListener('click', () => switchAuthTab('login'));
  $('#tab-register').addEventListener('click', () => switchAuthTab('register'));
  $('#login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitAuth(e.target, '/api/auth/login');
  });
  $('#register-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitAuth(e.target, '/api/auth/register');
  });

  $('#logout-btn').addEventListener('click', async () => {
    await api('POST', '/api/auth/logout');
    showAuth();
  });

  $('#post-body').addEventListener('input', updatePostCount);
  $('#post-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const flashEl = $('#post-flash');
    try {
      await api('POST', '/api/posts', { body: $('#post-body').value });
      $('#post-body').value = '';
      updatePostCount();
      flash(flashEl, '投稿しました。');
      await loadTimeline();
    } catch (err) {
      flash(flashEl, err.message, true);
    }
  });

  $('#reload-btn').addEventListener('click', () => loadTimeline().catch((err) => flash($('#post-flash'), err.message, true)));

  $('#timeline').addEventListener('click', async (e) => {
    const id = e.target.dataset.delete;
    if (!id || !confirm('この投稿を削除しますか？')) return;
    try {
      await api('DELETE', `/api/posts/${id}`);
      await loadTimeline();
    } catch (err) {
      flash($('#post-flash'), err.message, true);
    }
  });

  $('#key-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const flashEl = $('#key-flash');
    try {
      await api('PUT', '/api/me/api-key', { apiKey: $('#api-key').value });
      $('#api-key').value = '';
      flash(flashEl, 'APIキーを保存しました。');
      await loadKeyStatus();
    } catch (err) {
      flash(flashEl, err.message, true);
    }
  });

  $('#key-delete').addEventListener('click', async () => {
    if (!confirm('APIキーを削除しますか？')) return;
    const flashEl = $('#key-flash');
    try {
      await api('DELETE', '/api/me/api-key');
      flash(flashEl, 'APIキーを削除しました。');
      await loadKeyStatus();
    } catch (err) {
      flash(flashEl, err.message, true);
    }
  });

  $('#llm-create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const flashEl = $('#llm-flash');
    try {
      await api('POST', '/api/llm-accounts', Object.fromEntries(new FormData(form)));
      form.reset();
      flash(flashEl, 'LLMアカウントを作成しました。');
      await loadAccounts();
    } catch (err) {
      flash(flashEl, err.message, true);
    }
  });

  $('#llm-list').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const flashEl = $('#llm-flash');
    try {
      await api('PATCH', `/api/llm-accounts/${form.dataset.id}`, Object.fromEntries(new FormData(form)));
      flash(flashEl, '設定を保存しました。');
    } catch (err) {
      flash(flashEl, err.message, true);
    }
  });

  $('#llm-list').addEventListener('click', async (e) => {
    const id = e.target.dataset.generate;
    if (!id) return;
    const button = e.target;
    const flashEl = $('#llm-flash');
    button.disabled = true;
    try {
      await api('POST', `/api/llm-accounts/${id}/generate`);
      flash(flashEl, '投稿を生成してタイムラインに追加しました。');
      await loadTimeline();
    } catch (err) {
      flash(flashEl, err.message, true);
    } finally {
      button.disabled = false;
    }
  });

  $('#admin-users').addEventListener('click', async (e) => {
    const id = e.target.dataset.suspend;
    if (!id) return;
    const suspended = e.target.dataset.value === 'true';
    const flashEl = $('#admin-flash');
    try {
      await api('POST', `/api/admin/users/${id}/suspension`, { suspended });
      flash(flashEl, suspended ? '利用停止にしました。' : '利用停止を解除しました。');
      await loadUsers();
    } catch (err) {
      flash(flashEl, err.message, true);
    }
  });
}

async function init() {
  wireEvents();
  const { models: list } = await api('GET', '/api/models');
  models.push(...list);
  const { user } = await api('GET', '/api/auth/me');
  if (user) {
    await enterApp(user);
  } else {
    showAuth();
  }
}

init().catch((err) => {
  showAuth();
  flash($('#auth-flash'), `起動に失敗しました: ${err.message}`, true);
});
