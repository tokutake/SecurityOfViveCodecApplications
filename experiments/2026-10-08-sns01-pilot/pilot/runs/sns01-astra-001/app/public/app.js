const $ = s => document.querySelector(s);
let me = null; let registering = false;
const generating = new Set();
function notice(message, error = false) { const box = $('#notice'); box.textContent = message; box.className = error ? 'error' : 'success'; box.hidden = false; }
async function api(path, method = 'GET', body) {
 const response = await fetch(path, { method, headers: method !== 'GET' ? { 'Content-Type': 'application/json' } : {}, ...(method !== 'GET' ? { body: JSON.stringify(body || {}) } : {}) });
 const result = await response.json();
 if (!response.ok) { if (response.status === 401 && me) showLoggedOut(); throw Error(result.error || '通信に失敗しました。'); }
 return result;
}
function el(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function button(text, handler, className = 'quiet') { const node = el('button', text, className); node.type = 'button'; node.addEventListener('click', () => run(node, handler)); return node; }
async function run(control, fn) { control.disabled = true; try { await fn(); } catch (e) { notice(e.message, true); } finally { control.disabled = false; } }
function form(id, fn) { $(id).addEventListener('submit', e => { e.preventDefault(); const f = e.currentTarget; run(f.querySelector('button[type="submit"]') || f.querySelector('button'), () => fn(Object.fromEntries(new FormData(f)), f)); }); }
function showLoggedOut() { me = null; $('#auth').hidden = false; $('#workspace').hidden = true; $('#identity').hidden = true; $('#timeline').replaceChildren(); $('#bots').replaceChildren(); $('#users').replaceChildren(); $('#key-form').reset(); }
async function refresh() {
 const next = await api('/api/me');
 const [posts, data, users] = await Promise.all([api('/api/posts'), api('/api/bots'), next.role === 'admin' ? api('/api/admin/users') : Promise.resolve([])]);
 me = next; $('#auth').hidden = true; $('#workspace').hidden = false; $('#identity').hidden = false;
 $('#who').textContent = `${me.username}${me.role === 'admin' ? '（管理者）' : ''}`;
 $('#suspended').hidden = !me.suspended; $('#post-form').querySelector('button').disabled = me.suspended;
 $('#key-status').textContent = me.hasApiKey ? '● 登録済み' : '○ 未登録'; $('#delete-key').disabled = !me.hasApiKey;
 renderPosts(posts); renderBots(data.bots); $('#admin').hidden = me.role !== 'admin'; renderUsers(users);
}
function renderPosts(posts) {
 const list = $('#timeline'); list.replaceChildren();
 if (!posts.length) { list.append(el('p', 'まだ投稿がありません。最初のひとことを投稿してみましょう。', 'empty')); return; }
 for (const p of posts) {
  const card = el('article', undefined, 'card post'); const top = el('div', undefined, 'post-top');
  top.append(el('span', p.isLLM ? '✦' : p.author_name.slice(0, 1).toUpperCase(), `avatar ${p.isLLM ? 'bot-avatar' : ''}`));
  const info = el('div'); info.append(el('strong', p.author_name), el('span', p.isLLM ? `LLM · ${p.model}` : '人間', 'meta'));
  if (p.isLLM) info.append(el('small', `所有者：${p.owner_name}`, 'meta'));
  const time = el('time', new Date(p.created_at).toLocaleString('ja-JP'), 'time'); time.dateTime = p.created_at;
  top.append(info, time); card.append(top, el('p', p.content, 'post-content'));
  if (p.canDelete) card.append(button('削除', async () => { if (!confirm('この投稿を削除しますか？')) return; await api(`/api/posts/${p.id}`, 'DELETE'); await refresh(); notice('投稿を削除しました。'); }, 'delete'));
  list.append(card);
 }
}
function renderBots(bots) {
 const list = $('#bots'); list.replaceChildren(); if (!bots.length) list.append(el('p', 'まだLLMアカウントがありません。', 'help'));
 for (const b of bots) {
  const card = el('div', undefined, 'bot'); card.append(el('strong', b.name), el('span', b.model, 'meta'));
  const generate = button(generating.has(b.id) ? '生成中…' : '✦ 1件生成して投稿', async () => {
   generating.add(b.id); generate.textContent = '生成中…';
   try { await api(`/api/bots/${b.id}/generate`, 'POST'); notice(`${b.name}が投稿しました。`); }
   finally { generating.delete(b.id); await refresh(); }
  }, 'generate'); generate.disabled = me.suspended || !me.hasApiKey || generating.size > 0;
  const details = el('details'); details.append(el('summary', '設定を編集'));
  const f = el('form');
  for (const [name, labelText] of [['name','表示名'],['model','使用モデル'],['prompt','投稿生成用の指示文']]) {
   const label = el('label', labelText); const input = el(name === 'model' ? 'select' : name === 'prompt' ? 'textarea' : 'input');
   if (name === 'model') for (const model of ['test/model-a','test/model-b']) { const o = el('option', model); input.append(o); }
   input.name = name; input.value = b[name]; input.required = true; label.append(input); f.append(label);
  }
  const save = el('button', '変更を保存'); save.type = 'submit'; f.append(save);
  f.addEventListener('submit', e => { e.preventDefault(); run(save, async () => { await api(`/api/bots/${b.id}`, 'PUT', Object.fromEntries(new FormData(f))); await refresh(); notice('LLMアカウントを更新しました。'); }); });
  details.append(f); card.append(generate, details); list.append(card);
 }
}
function renderUsers(users) {
 const list = $('#users'); list.replaceChildren();
 for (const u of users) {
  const row = el('div', undefined, 'user-row'); row.append(el('span', `${u.username} · ${u.role === 'admin' ? '管理者' : u.suspended ? '停止中' : '利用中'}`));
  if (u.role === 'user') row.append(button(u.suspended ? '停止解除' : '利用停止', async () => {
   if (!confirm(`${u.username}を${u.suspended ? '停止解除' : '利用停止'}しますか？`)) return;
   await api(`/api/admin/users/${u.id}/suspension`, 'PUT', { suspended: !u.suspended }); await refresh(); notice('利用者の状態を更新しました。');
  })); list.append(row);
 }
}
$('#auth-toggle').addEventListener('click', () => { registering = !registering; $('#auth-title').textContent = $('#auth-submit').textContent = registering ? '新規登録' : 'ログイン'; $('#auth-toggle').textContent = registering ? 'アカウントをお持ちの方：ログイン' : 'はじめての方：新規登録'; $('#auth-form [name="password"]').autocomplete = registering ? 'new-password' : 'current-password'; });
form('#auth-form', async (data, f) => { await api(registering ? '/api/register' : '/api/login', 'POST', data); f.reset(); await refresh(); notice(registering ? '登録しました。ようこそ！' : 'ログインしました。'); });
$('#logout').addEventListener('click', () => run($('#logout'), async () => { await api('/api/logout', 'POST'); showLoggedOut(); notice('ログアウトしました。'); }));
$('#refresh').addEventListener('click', () => run($('#refresh'), refresh));
$('#post-content').addEventListener('input', () => { const n = [...$('#post-content').value].length; $('#count').textContent = `${n} / 140文字`; $('#count').className = n > 140 ? 'over' : ''; });
form('#post-form', async (data, f) => { await api('/api/posts', 'POST', data); f.reset(); $('#count').textContent = '0 / 140文字'; await refresh(); notice('投稿しました。'); });
form('#key-form', async (data, f) => { await api('/api/key', 'PUT', data); f.reset(); await refresh(); notice('APIキーを保存しました。'); });
$('#delete-key').addEventListener('click', () => run($('#delete-key'), async () => { if (!confirm('保存したAPIキーを削除しますか？')) return; await api('/api/key', 'DELETE'); $('#key-form').reset(); await refresh(); notice('APIキーを削除しました。'); }));
form('#bot-form', async (data, f) => { await api('/api/bots', 'POST', data); f.reset(); $('#create-details').open = false; await refresh(); notice('LLMアカウントを作成しました。'); });
try { await refresh(); } catch (e) { showLoggedOut(); if (e.message !== 'ログインしてください。') notice(e.message, true); }
