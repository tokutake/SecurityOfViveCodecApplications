# Micro SNS

A small SNS web application built with TanStack Start 1.169.1 and SQLite.

## Features

- **Timeline**: View public posts from all users and post your own (public or private)
- **Private Posts**: Posts marked private are visible only to you
- **DM Groups**: Create groups and send messages visible only to members
- **OIDC Authentication**: Login via any OIDC-compatible provider (Google, Keycloak, Auth0, etc.)

## Requirements

- Node.js 18 or later
- npm 9 or later

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:

| Variable             | Description                                      | Example                          |
|----------------------|--------------------------------------------------|----------------------------------|
| `OIDC_ISSUER`        | OIDC provider discovery URL                      | `https://accounts.google.com`    |
| `OIDC_CLIENT_ID`     | OAuth client ID from your provider               | `your-client-id`                 |
| `OIDC_CLIENT_SECRET` | OAuth client secret from your provider           | `your-client-secret`             |
| `APP_URL`            | Public base URL of this app (no trailing slash)  | `http://localhost:3000`          |
| `PORT`               | HTTP port (default: `3000`)                      | `3000`                           |

#### OIDC Provider Setup

Register a new OAuth 2.0 / OIDC application with your provider and set the **redirect URI** to:

```
{APP_URL}/api/auth/callback
```

For Google: create a project in Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID (Web application). Add `http://localhost:3000/api/auth/callback` to Authorized redirect URIs.

### 3. Start the development server

```bash
npm run dev
```

The app will be available at `http://localhost:3000` (or the port you set).

## Production

Build and start:

```bash
npm run build
npm start
```

The production server reads `PORT` from the environment.

## Database

The app uses SQLite. The database file `data.db` is created automatically in the current working directory on first run. No migration steps are needed.
