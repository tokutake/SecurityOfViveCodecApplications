#!/usr/bin/env node

import http from 'http';
import fs from 'fs';
import path from 'path';
import url from 'url';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const MOCK_API_URL = process.env.OPENROUTER_URL || 'http://localhost:3001';

// Session storage
const sessions = new Map();
const sessionExpiry = 24 * 60 * 60 * 1000; // 24 hours

// Initialize database
const db = new DatabaseSync('data.db');

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_keys (
      user_id INTEGER PRIMARY KEY,
      openrouter_key TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS llm_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      display_name TEXT NOT NULL,
      model_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id INTEGER,
      llm_account_id INTEGER,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME,
      FOREIGN KEY (author_id) REFERENCES users(id),
      FOREIGN KEY (llm_account_id) REFERENCES llm_accounts(id)
    );

    CREATE TABLE IF NOT EXISTS api_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_identifier TEXT NOT NULL,
      model_id TEXT NOT NULL,
      call_count INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

function createSession(userId) {
  const sessionId = generateSessionId();
  sessions.set(sessionId, {
    userId,
    createdAt: Date.now()
  });
  return sessionId;
}

function getSession(sessionId) {
  if (!sessions.has(sessionId)) return null;
  const session = sessions.get(sessionId);
  if (Date.now() - session.createdAt > sessionExpiry) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

function deleteSession(sessionId) {
  sessions.delete(sessionId);
}

// Helper functions
function getContentType(pathname) {
  const ext = path.extname(pathname);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
  };
  return types[ext] || 'application/octet-stream';
}

function parseUrl(urlStr) {
  return url.parse(urlStr, true);
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      resolve(body);
    });
    req.on('error', reject);
  });
}

// API Handlers
const apiHandlers = {
  'GET /api/session': (req, res, session) => {
    if (!session) {
      return [401, { error: 'Not authenticated' }];
    }
    try {
      const user = db.prepare('SELECT id, username, role, status FROM users WHERE id = ?').get(session.userId);
      if (!user) {
        return [401, { error: 'User not found' }];
      }
      const hasKey = !!db.prepare('SELECT 1 FROM user_keys WHERE user_id = ?').get(session.userId);
      return [200, { user: { ...user, hasOpenRouterKey: hasKey } }];
    } catch (error) {
      return [500, { error: error.message }];
    }
  },

  'POST /api/register': async (req, res, session, body) => {
    try {
      const data = JSON.parse(body);
      const { username, password } = data;
      if (!username || !password) {
        return [400, { error: 'Username and password required' }];
      }
      if (username.length < 3) {
        return [400, { error: 'Username must be at least 3 characters' }];
      }
      const passwordHash = hashPassword(password);
      db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, passwordHash);
      return [200, { message: 'User registered' }];
    } catch (error) {
      if (error.message.includes('UNIQUE')) {
        return [400, { error: 'Username already exists' }];
      }
      return [500, { error: error.message }];
    }
  },

  'POST /api/login': async (req, res, session, body) => {
    try {
      const data = JSON.parse(body);
      const { username, password } = data;
      if (!username || !password) {
        return [400, { error: 'Username and password required' }];
      }
      const user = db.prepare('SELECT id, password_hash, status FROM users WHERE username = ?').get(username);
      if (!user || user.password_hash !== hashPassword(password)) {
        return [400, { error: 'Invalid credentials' }];
      }
      if (user.status === 'suspended') {
        return [403, { error: 'Account suspended' }];
      }
      const sessionId = createSession(user.id);
      res.setHeader('Set-Cookie', `session=${sessionId}; Path=/; HttpOnly; Max-Age=${sessionExpiry / 1000}`);
      return [200, { message: 'Logged in' }];
    } catch (error) {
      return [500, { error: error.message }];
    }
  },

  'POST /api/logout': (req, res, session) => {
    if (session) {
      for (const [key, value] of sessions.entries()) {
        if (value === session) {
          deleteSession(key);
          break;
        }
      }
    }
    res.setHeader('Set-Cookie', 'session=; Path=/; HttpOnly; Max-Age=0');
    return [200, { message: 'Logged out' }];
  },

  'POST /api/set-openrouter-key': async (req, res, session, body) => {
    if (!session) {
      return [401, { error: 'Not authenticated' }];
    }
    try {
      const data = JSON.parse(body);
      const { key } = data;
      if (!key) {
        return [400, { error: 'Key required' }];
      }
      const existing = db.prepare('SELECT 1 FROM user_keys WHERE user_id = ?').get(session.userId);
      if (existing) {
        db.prepare('UPDATE user_keys SET openrouter_key = ? WHERE user_id = ?').run(key, session.userId);
      } else {
        db.prepare('INSERT INTO user_keys (user_id, openrouter_key) VALUES (?, ?)').run(session.userId, key);
      }
      return [200, { message: 'Key updated' }];
    } catch (error) {
      return [500, { error: error.message }];
    }
  },

  'DELETE /api/openrouter-key': (req, res, session) => {
    if (!session) {
      return [401, { error: 'Not authenticated' }];
    }
    try {
      db.prepare('DELETE FROM user_keys WHERE user_id = ?').run(session.userId);
      return [200, { message: 'Key deleted' }];
    } catch (error) {
      return [500, { error: error.message }];
    }
  },

  'GET /api/llm-accounts': (req, res, session) => {
    if (!session) {
      return [401, { error: 'Not authenticated' }];
    }
    try {
      const accounts = db.prepare(`
        SELECT id, display_name, model_id, owner_id FROM llm_accounts WHERE owner_id = ?
      `).all(session.userId);
      return [200, { accounts }];
    } catch (error) {
      return [500, { error: error.message }];
    }
  },

  'POST /api/llm-accounts': async (req, res, session, body) => {
    if (!session) {
      return [401, { error: 'Not authenticated' }];
    }
    try {
      const data = JSON.parse(body);
      const { displayName, modelId, prompt } = data;
      if (!displayName || !modelId || !prompt) {
        return [400, { error: 'All fields required' }];
      }
      if (!['test/model-a', 'test/model-b'].includes(modelId)) {
        return [400, { error: 'Invalid model' }];
      }
      const result = db.prepare(`
        INSERT INTO llm_accounts (owner_id, display_name, model_id, prompt)
        VALUES (?, ?, ?, ?)
      `).run(session.userId, displayName, modelId, prompt);
      return [200, { id: result.lastInsertRowid }];
    } catch (error) {
      return [500, { error: error.message }];
    }
  },

  'PUT /api/llm-accounts/:id': async (req, res, session, body, params) => {
    if (!session) {
      return [401, { error: 'Not authenticated' }];
    }
    try {
      const account = db.prepare('SELECT owner_id FROM llm_accounts WHERE id = ?').get(params.id);
      if (!account) {
        return [404, { error: 'Account not found' }];
      }
      if (account.owner_id !== session.userId) {
        return [403, { error: 'Not authorized' }];
      }
      const data = JSON.parse(body);
      const { displayName, modelId, prompt } = data;
      if (!['test/model-a', 'test/model-b'].includes(modelId)) {
        return [400, { error: 'Invalid model' }];
      }
      db.prepare(`
        UPDATE llm_accounts SET display_name = ?, model_id = ?, prompt = ? WHERE id = ?
      `).run(displayName, modelId, prompt, params.id);
      return [200, { message: 'Updated' }];
    } catch (error) {
      return [500, { error: error.message }];
    }
  },

  'GET /api/posts': (req, res, session) => {
    try {
      const posts = db.prepare(`
        SELECT
          p.id, p.content, p.created_at, p.author_id, p.llm_account_id,
          u.username, u.status, l.display_name, l.model_id, l.owner_id
        FROM posts p
        LEFT JOIN users u ON p.author_id = u.id
        LEFT JOIN llm_accounts l ON p.llm_account_id = l.id
        WHERE p.deleted_at IS NULL
        ORDER BY p.created_at DESC
      `).all();
      return [200, { posts }];
    } catch (error) {
      return [500, { error: error.message }];
    }
  },

  'POST /api/posts': async (req, res, session, body) => {
    if (!session) {
      return [401, { error: 'Not authenticated' }];
    }
    try {
      const user = db.prepare('SELECT status FROM users WHERE id = ?').get(session.userId);
      if (user.status === 'suspended') {
        return [403, { error: 'Account suspended' }];
      }
      const data = JSON.parse(body);
      const { content } = data;
      if (!content || content.trim() === '') {
        return [400, { error: 'Post cannot be empty' }];
      }
      const charCount = [...content].length;
      if (charCount > 140) {
        return [400, { error: 'Post exceeds 140 characters' }];
      }
      const result = db.prepare(`
        INSERT INTO posts (author_id, content, created_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `).run(session.userId, content);
      return [200, { id: result.lastInsertRowid }];
    } catch (error) {
      return [500, { error: error.message }];
    }
  },

  'POST /api/posts/:id/generate-llm': async (req, res, session, body, params) => {
    if (!session) {
      return [401, { error: 'Not authenticated' }];
    }
    try {
      const llmAccount = db.prepare(`
        SELECT la.id, la.owner_id, la.model_id, la.prompt, u.status
        FROM llm_accounts la
        JOIN users u ON la.owner_id = u.id
        WHERE la.id = ?
      `).get(params.id);

      if (!llmAccount) {
        return [404, { error: 'LLM account not found' }];
      }
      if (llmAccount.owner_id !== session.userId) {
        return [403, { error: 'Not authorized' }];
      }
      if (llmAccount.status === 'suspended') {
        return [403, { error: 'Account suspended' }];
      }

      const keyRecord = db.prepare('SELECT openrouter_key FROM user_keys WHERE user_id = ?').get(session.userId);
      if (!keyRecord) {
        return [400, { error: 'OpenRouter key not set' }];
      }

      try {
        const response = await fetch(`${MOCK_API_URL}/api/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${keyRecord.openrouter_key}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: llmAccount.model_id,
            messages: [{ role: 'user', content: llmAccount.prompt }]
          })
        });

        if (!response.ok) {
          const error = await response.text();
          return [500, { error: `LLM API error: ${error}` }];
        }

        const result = await response.json();
        if (!result.choices || !result.choices[0] || !result.choices[0].message) {
          return [500, { error: 'Invalid LLM response' }];
        }

        const content = result.choices[0].message.content;
        const charCount = [...content].length;
        if (charCount > 140) {
          return [400, { error: 'Generated content exceeds 140 characters' }];
        }

        const postResult = db.prepare(`
          INSERT INTO posts (llm_account_id, content, created_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
        `).run(params.id, content);

        return [200, { id: postResult.lastInsertRowid, content }];
      } catch (fetchError) {
        return [500, { error: `Failed to call LLM API: ${fetchError.message}` }];
      }
    } catch (error) {
      return [500, { error: error.message }];
    }
  },

  'DELETE /api/posts/:id': async (req, res, session, body, params) => {
    if (!session) {
      return [401, { error: 'Not authenticated' }];
    }
    try {
      const post = db.prepare('SELECT author_id, deleted_at FROM posts WHERE id = ?').get(params.id);
      if (!post) {
        return [404, { error: 'Post not found' }];
      }
      if (post.deleted_at) {
        return [404, { error: 'Post already deleted' }];
      }

      const user = db.prepare('SELECT role FROM users WHERE id = ?').get(session.userId);
      if (user.role !== 'admin' && post.author_id !== session.userId) {
        return [403, { error: 'Not authorized' }];
      }

      db.prepare('UPDATE posts SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(params.id);
      return [200, { message: 'Post deleted' }];
    } catch (error) {
      return [500, { error: error.message }];
    }
  },

  'GET /api/users': (req, res, session) => {
    if (!session) {
      return [401, { error: 'Not authenticated' }];
    }
    try {
      const user = db.prepare('SELECT role FROM users WHERE id = ?').get(session.userId);
      if (user.role !== 'admin') {
        return [403, { error: 'Not authorized' }];
      }
      const users = db.prepare('SELECT id, username, role, status FROM users ORDER BY id').all();
      return [200, { users }];
    } catch (error) {
      return [500, { error: error.message }];
    }
  },

  'PUT /api/users/:id/suspend': async (req, res, session, body, params) => {
    if (!session) {
      return [401, { error: 'Not authenticated' }];
    }
    try {
      const user = db.prepare('SELECT role FROM users WHERE id = ?').get(session.userId);
      if (user.role !== 'admin') {
        return [403, { error: 'Not authorized' }];
      }
      db.prepare('UPDATE users SET status = ? WHERE id = ?').run('suspended', params.id);
      return [200, { message: 'User suspended' }];
    } catch (error) {
      return [500, { error: error.message }];
    }
  },

  'PUT /api/users/:id/unsuspend': async (req, res, session, body, params) => {
    if (!session) {
      return [401, { error: 'Not authenticated' }];
    }
    try {
      const user = db.prepare('SELECT role FROM users WHERE id = ?').get(session.userId);
      if (user.role !== 'admin') {
        return [403, { error: 'Not authorized' }];
      }
      db.prepare('UPDATE users SET status = ? WHERE id = ?').run('active', params.id);
      return [200, { message: 'User unsuspended' }];
    } catch (error) {
      return [500, { error: error.message }];
    }
  }
};

// Mock OpenRouter API
const mockApiServer = http.createServer(async (req, res) => {
  const parsedUrl = parseUrl(req.url);

  if (req.method === 'POST' && parsedUrl.pathname === '/api/v1/chat/completions') {
    const body = await readBody(req);
    try {
      const data = JSON.parse(body);
      const authHeader = req.headers.authorization || '';
      const token = authHeader.replace('Bearer ', '');
      const { model, messages } = data;

      if (!model || !messages) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Missing model or messages' }));
      }

      // Track API call
      const keyId = token.substring(0, 8);
      const existing = db.prepare(`
        SELECT call_count FROM api_calls WHERE key_identifier = ? AND model_id = ?
      `).get(keyId, model);

      if (existing) {
        db.prepare(`
          UPDATE api_calls SET call_count = call_count + 1 WHERE key_identifier = ? AND model_id = ?
        `).run(keyId, model);
      } else {
        db.prepare(`
          INSERT INTO api_calls (key_identifier, model_id, call_count) VALUES (?, ?, 1)
        `).run(keyId, model);
      }

      const responses = {
        'test/model-a': 'これはtest/model-aの返答です。',
        'test/model-b': 'これはtest/model-bの返答です。'
      };

      const content = responses[model] || `モデル${model}からの返答`;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{
          message: { content }
        }]
      }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

const MOCK_API_PORT = 3001;
mockApiServer.listen(MOCK_API_PORT, () => {
  console.log(`Mock OpenRouter API listening on port ${MOCK_API_PORT}`);
});

mockApiServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE' || err.code === 'EPERM') {
    console.warn(`Warning: Could not start mock API on port ${MOCK_API_PORT}. Local port binding may be restricted.`);
    console.warn('To enable local port binding, configure: sandbox.network.allowLocalBinding: true');
  } else {
    throw err;
  }
});

// Main HTTP server
const server = http.createServer(async (req, res) => {
  const parsedUrl = parseUrl(req.url);
  const pathname = parsedUrl.pathname;

  // Get session from cookie
  const cookies = (req.headers.cookie || '').split(';').reduce((acc, cookie) => {
    const [key, value] = cookie.trim().split('=');
    acc[key] = value;
    return acc;
  }, {});
  const session = getSession(cookies.session);

  // Static files
  if (pathname === '/' || pathname === '/index.html') {
    const filePath = path.join(__dirname, 'public', 'index.html');
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      res.writeHead(200, { 'Content-Type': getContentType('/index.html') });
      return res.end(content);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'File not found' }));
    }
  }

  if (pathname.startsWith('/public/')) {
    const filePath = path.join(__dirname, pathname);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      res.writeHead(200, { 'Content-Type': getContentType(pathname) });
      return res.end(content);
    } catch (error) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'File not found' }));
    }
  }

  // API routes
  const body = req.method !== 'GET' ? await readBody(req) : '';
  const [status, responseBody] = handleApiRoute(req.method, pathname, session, body, res);

  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(responseBody));
});

function handleApiRoute(method, pathname, session, body, res) {
  for (const [route, handler] of Object.entries(apiHandlers)) {
    const [routeMethod, routePath] = route.split(' ');

    if (method !== routeMethod) continue;

    // Simple route matching
    if (routePath === pathname) {
      return handler(null, res, session, body);
    }

    // Parameterized routes
    const routePattern = routePath.replace(/:(\w+)/g, '(?<$1>[^/]+)');
    const regex = new RegExp(`^${routePattern}$`);
    const match = pathname.match(regex);

    if (match) {
      const params = match.groups || {};
      return handler(null, res, session, body, params);
    }
  }

  return [404, { error: 'Not found' }];
}

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  initDatabase();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use.`);
    process.exit(1);
  } else if (err.code === 'EPERM') {
    console.error(`Cannot bind to port ${PORT}. Local port binding is restricted in this environment.`);
    console.error('To enable local port binding, configure: sandbox.network.allowLocalBinding: true');
    process.exit(1);
  } else {
    throw err;
  }
});
