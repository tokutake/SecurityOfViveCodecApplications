let currentUser = null;
let currentEditingLlmId = null;

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
  const session = await checkSession();
  if (session) {
    currentUser = session.user;
    showMainScreen();
  } else {
    showAuthScreen();
  }
  setupEventListeners();
});

async function checkSession() {
  try {
    const response = await fetch('/api/session');
    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    console.error('Session check error:', error);
  }
  return null;
}

function setupEventListeners() {
  // Auth tabs
  document.getElementById('loginTab')?.addEventListener('click', () => switchAuthTab('login'));
  document.getElementById('registerTab')?.addEventListener('click', () => switchAuthTab('register'));

  // Auth forms
  document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
  document.getElementById('registerForm')?.addEventListener('submit', handleRegister);

  // Main app
  document.getElementById('logoutBtn')?.addEventListener('click', handleLogout);
  document.getElementById('setKeyBtn')?.addEventListener('click', handleSetKey);
  document.getElementById('deleteKeyBtn')?.addEventListener('click', handleDeleteKey);
  document.getElementById('newLlmBtn')?.addEventListener('click', () => openLlmModal());
  document.getElementById('manageUsersBtn')?.addEventListener('click', handleManageUsers);

  // Post modal
  const postModal = document.getElementById('postModal');
  postModal?.querySelector('.close')?.addEventListener('click', () => closeLlmModal(postModal));
  document.getElementById('postForm')?.addEventListener('submit', handlePostSubmit);
  document.getElementById('postContent')?.addEventListener('input', updateCharCount);

  // LLM modal
  const llmModal = document.getElementById('llmModal');
  llmModal?.querySelector('.close')?.addEventListener('click', () => closeLlmModal(llmModal));
  document.getElementById('llmForm')?.addEventListener('submit', handleLlmFormSubmit);

  // User management modal
  const userManagementModal = document.getElementById('userManagementModal');
  userManagementModal?.querySelector('.close')?.addEventListener('click', () => closeLlmModal(userManagementModal));
}

function switchAuthTab(tab) {
  const loginTab = document.getElementById('loginTab');
  const registerTab = document.getElementById('registerTab');
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');

  if (tab === 'login') {
    loginTab.classList.add('active');
    registerTab.classList.remove('active');
    loginForm.style.display = 'flex';
    registerForm.style.display = 'none';
  } else {
    loginTab.classList.remove('active');
    registerTab.classList.add('active');
    loginForm.style.display = 'none';
    registerForm.style.display = 'flex';
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value;
  const password = document.getElementById('loginPassword').value;

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (response.ok) {
      const session = await checkSession();
      if (session) {
        currentUser = session.user;
        showMainScreen();
      }
    } else {
      const error = await response.json();
      document.getElementById('loginError').textContent = error.error || 'ログインに失敗しました';
    }
  } catch (error) {
    document.getElementById('loginError').textContent = 'エラーが発生しました';
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const username = document.getElementById('registerUsername').value;
  const password = document.getElementById('registerPassword').value;

  try {
    const response = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (response.ok) {
      document.getElementById('registerUsername').value = '';
      document.getElementById('registerPassword').value = '';
      document.getElementById('registerError').textContent = '登録成功。ログインしてください。';
      setTimeout(() => switchAuthTab('login'), 1500);
    } else {
      const error = await response.json();
      document.getElementById('registerError').textContent = error.error || '登録に失敗しました';
    }
  } catch (error) {
    document.getElementById('registerError').textContent = 'エラーが発生しました';
  }
}

async function handleLogout() {
  try {
    await fetch('/api/logout', { method: 'POST' });
    currentUser = null;
    showAuthScreen();
  } catch (error) {
    alert('ログアウトに失敗しました');
  }
}

function showAuthScreen() {
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('mainScreen').style.display = 'none';
  switchAuthTab('login');
}

async function showMainScreen() {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('mainScreen').style.display = 'flex';

  if (currentUser) {
    document.getElementById('currentUsername').textContent = currentUser.username;
    document.getElementById('userRole').textContent = currentUser.role === 'admin' ? '管理者' : 'ユーザー';

    if (currentUser.role === 'admin') {
      document.getElementById('adminSection').style.display = 'block';
    } else {
      document.getElementById('adminSection').style.display = 'none';
    }

    updateKeyStatus();
    loadLlmAccounts();
    loadTimeline();

    // Refresh timeline every 10 seconds
    setInterval(loadTimeline, 10000);
  }
}

async function updateKeyStatus() {
  const session = await checkSession();
  if (session && session.user) {
    const status = session.user.hasOpenRouterKey ? '登録済み' : '未登録';
    const statusClass = session.user.hasOpenRouterKey ? 'registered' : 'not-registered';
    document.getElementById('keyStatus').innerHTML = `ステータス: <strong class="${statusClass}">${status}</strong>`;
  }
}

async function handleSetKey() {
  const key = document.getElementById('apiKeyInput').value;
  if (!key) {
    alert('キーを入力してください');
    return;
  }

  try {
    const response = await fetch('/api/set-openrouter-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });

    if (response.ok) {
      document.getElementById('apiKeyInput').value = '';
      alert('キーを設定しました');
      updateKeyStatus();
    } else {
      const error = await response.json();
      alert(error.error || 'キーの設定に失敗しました');
    }
  } catch (error) {
    alert('エラーが発生しました');
  }
}

async function handleDeleteKey() {
  if (!confirm('キーを削除してもよろしいですか？')) return;

  try {
    const response = await fetch('/api/openrouter-key', { method: 'DELETE' });
    if (response.ok) {
      alert('キーを削除しました');
      updateKeyStatus();
    } else {
      const error = await response.json();
      alert(error.error || 'キーの削除に失敗しました');
    }
  } catch (error) {
    alert('エラーが発生しました');
  }
}

async function loadLlmAccounts() {
  try {
    const response = await fetch('/api/llm-accounts');
    if (response.ok) {
      const data = await response.json();
      displayLlmAccounts(data.accounts);
    }
  } catch (error) {
    console.error('Failed to load LLM accounts:', error);
  }
}

function displayLlmAccounts(accounts) {
  const list = document.getElementById('llmAccountsList');
  list.innerHTML = '';

  if (accounts.length === 0) {
    list.innerHTML = '<p style="font-size: 0.9rem; color: #999;">LLMアカウントなし</p>';
    return;
  }

  accounts.forEach(account => {
    const div = document.createElement('div');
    div.className = 'llm-account-item';
    div.innerHTML = `
      <div class="llm-account-name">${escapeHtml(account.display_name)}</div>
      <div class="llm-account-model">${account.model_id}</div>
    `;
    div.addEventListener('click', () => showLlmAccountMenu(account));
    list.appendChild(div);
  });
}

function showLlmAccountMenu(account) {
  const choice = prompt(`${account.display_name}\n\n[編集] キーワード: edit\n[削除] キーワード: delete`);
  if (choice === 'edit') {
    openLlmModal(account);
  } else if (choice === 'delete') {
    // Delete is not in current spec, but we can add if needed
  }
}

function openLlmModal(account = null) {
  currentEditingLlmId = account?.id || null;
  const modal = document.getElementById('llmModal');
  const title = document.getElementById('llmModalTitle');
  const form = document.getElementById('llmForm');
  const submitBtn = document.getElementById('llmSubmitBtn');

  if (account) {
    title.textContent = 'LLMアカウント編集';
    document.getElementById('llmDisplayName').value = account.display_name;
    document.getElementById('llmModel').value = account.model_id;
    document.getElementById('llmPrompt').value = account.prompt;
    submitBtn.textContent = '更新';
  } else {
    title.textContent = 'LLMアカウント作成';
    form.reset();
    submitBtn.textContent = '作成';
  }

  modal.style.display = 'flex';
}

function closeLlmModal(modal) {
  modal.style.display = 'none';
}

async function handleLlmFormSubmit(e) {
  e.preventDefault();

  const displayName = document.getElementById('llmDisplayName').value;
  const modelId = document.getElementById('llmModel').value;
  const prompt = document.getElementById('llmPrompt').value;

  try {
    let response;
    if (currentEditingLlmId) {
      response = await fetch(`/api/llm-accounts/${currentEditingLlmId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, modelId, prompt })
      });
    } else {
      response = await fetch('/api/llm-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, modelId, prompt })
      });
    }

    if (response.ok) {
      document.getElementById('llmForm').reset();
      closeLlmModal(document.getElementById('llmModal'));
      loadLlmAccounts();
    } else {
      const error = await response.json();
      document.getElementById('llmError').textContent = error.error || 'エラーが発生しました';
    }
  } catch (error) {
    document.getElementById('llmError').textContent = 'エラーが発生しました';
  }
}

async function loadTimeline() {
  try {
    const response = await fetch('/api/posts');
    if (response.ok) {
      const data = await response.json();
      displayTimeline(data.posts);
    }
  } catch (error) {
    console.error('Failed to load timeline:', error);
  }
}

function displayTimeline(posts) {
  const timeline = document.getElementById('timeline');
  timeline.innerHTML = '';

  if (posts.length === 0) {
    timeline.innerHTML = '<div style="text-align: center; color: #999; padding: 2rem;">投稿がありません</div>';
  }

  posts.forEach(post => {
    const postEl = document.createElement('div');
    postEl.className = 'post';

    const isLlm = post.llm_account_id !== null;
    const authorName = isLlm ? post.display_name : post.username;
    const authorInfo = isLlm
      ? `<span class="post-badge">LLM</span><span class="post-model">${post.model_id}</span>`
      : '';

    const date = new Date(post.created_at);
    const timeStr = date.toLocaleString('ja-JP');

    let actions = '';
    if (!isLlm && post.author_id === currentUser.id) {
      actions = `<button class="btn-secondary" onclick="deletePost(${post.id})">削除</button>`;
    } else if (currentUser.role === 'admin') {
      actions = `<button class="btn-danger" onclick="deletePost(${post.id})">削除</button>`;
    }

    if (isLlm && post.owner_id === currentUser.id) {
      actions += `<button class="btn-primary" onclick="generatePost(${post.llm_account_id})">投稿生成</button>`;
    }

    postEl.innerHTML = `
      <div class="post-header">
        <div class="post-author">
          <span class="post-author-name">${escapeHtml(authorName)}</span>
          ${authorInfo}
        </div>
        <span class="post-time">${timeStr}</span>
      </div>
      <div class="post-content">${escapeHtml(post.content)}</div>
      <div class="post-actions">
        ${actions}
      </div>
    `;
    timeline.appendChild(postEl);
  });

  // Add compose button at top
  const composeBtn = document.createElement('button');
  composeBtn.className = 'btn-primary';
  composeBtn.textContent = '新規投稿';
  composeBtn.style.width = '100%';
  composeBtn.style.marginBottom = '1rem';
  composeBtn.onclick = () => openPostModal();
  timeline.insertBefore(composeBtn, timeline.firstChild);
}

function openPostModal() {
  document.getElementById('postForm').reset();
  document.getElementById('postError').textContent = '';
  document.getElementById('charCount').textContent = '0';
  document.getElementById('postModal').style.display = 'flex';
}

function updateCharCount() {
  const content = document.getElementById('postContent').value;
  const count = [...content].length;
  document.getElementById('charCount').textContent = count;
}

async function handlePostSubmit(e) {
  e.preventDefault();
  const content = document.getElementById('postContent').value;

  try {
    const response = await fetch('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });

    if (response.ok) {
      document.getElementById('postForm').reset();
      closeLlmModal(document.getElementById('postModal'));
      loadTimeline();
    } else {
      const error = await response.json();
      document.getElementById('postError').textContent = error.error || 'エラーが発生しました';
    }
  } catch (error) {
    document.getElementById('postError').textContent = 'エラーが発生しました';
  }
}

async function deletePost(postId) {
  if (!confirm('投稿を削除してもよろしいですか？')) return;

  try {
    const response = await fetch(`/api/posts/${postId}`, { method: 'DELETE' });
    if (response.ok) {
      loadTimeline();
    } else {
      const error = await response.json();
      alert(error.error || '削除に失敗しました');
    }
  } catch (error) {
    alert('エラーが発生しました');
  }
}

async function generatePost(llmAccountId) {
  if (!confirm('LLMで投稿を生成しますか？')) return;

  try {
    const response = await fetch(`/api/posts/${llmAccountId}/generate-llm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (response.ok) {
      loadTimeline();
      alert('投稿を生成しました');
    } else {
      const error = await response.json();
      alert(error.error || '生成に失敗しました');
    }
  } catch (error) {
    alert('エラーが発生しました');
  }
}

async function handleManageUsers() {
  try {
    const response = await fetch('/api/users');
    if (response.ok) {
      const data = await response.json();
      displayUserManagement(data.users);
      document.getElementById('userManagementModal').style.display = 'flex';
    } else {
      alert('ユーザー一覧の取得に失敗しました');
    }
  } catch (error) {
    alert('エラーが発生しました');
  }
}

function displayUserManagement(users) {
  const usersList = document.getElementById('usersList');
  usersList.innerHTML = '';

  users.forEach(user => {
    if (user.id === currentUser.id) return; // Don't manage self

    const div = document.createElement('div');
    div.className = 'user-item';

    const isSuspended = user.status === 'suspended';
    const statusText = isSuspended ? '停止中' : 'アクティブ';
    const actionBtn = isSuspended
      ? `<button class="btn-primary" onclick="unsuspendUser(${user.id})">停止解除</button>`
      : `<button class="btn-danger" onclick="suspendUser(${user.id})">停止</button>`;

    div.innerHTML = `
      <div class="user-item-info">
        <div class="user-item-name">${escapeHtml(user.username)}</div>
        <div class="user-item-status">${user.role === 'admin' ? '管理者' : 'ユーザー'} - ${statusText}</div>
      </div>
      <div class="user-item-actions">
        ${actionBtn}
      </div>
    `;
    usersList.appendChild(div);
  });
}

async function suspendUser(userId) {
  if (!confirm('このユーザーを停止しますか？')) return;

  try {
    const response = await fetch(`/api/users/${userId}/suspend`, { method: 'PUT' });
    if (response.ok) {
      const usersResponse = await fetch('/api/users');
      if (usersResponse.ok) {
        const data = await usersResponse.json();
        displayUserManagement(data.users);
      }
    } else {
      alert('停止に失敗しました');
    }
  } catch (error) {
    alert('エラーが発生しました');
  }
}

async function unsuspendUser(userId) {
  if (!confirm('このユーザーの停止を解除しますか？')) return;

  try {
    const response = await fetch(`/api/users/${userId}/unsuspend`, { method: 'PUT' });
    if (response.ok) {
      const usersResponse = await fetch('/api/users');
      if (usersResponse.ok) {
        const data = await usersResponse.json();
        displayUserManagement(data.users);
      }
    } else {
      alert('解除に失敗しました');
    }
  } catch (error) {
    alert('エラーが発生しました');
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Close modals on background click
document.addEventListener('click', (e) => {
  const postModal = document.getElementById('postModal');
  const llmModal = document.getElementById('llmModal');
  const userManagementModal = document.getElementById('userManagementModal');

  if (e.target === postModal) closeLlmModal(postModal);
  if (e.target === llmModal) closeLlmModal(llmModal);
  if (e.target === userManagementModal) closeLlmModal(userManagementModal);
});
