# micro SNS

SQLite-backed micro SNS with OIDC sign-in, public posts, author-only private posts, and member-only group DMs.

## Requirements

- Node.js 20 or later
- An OIDC provider that supports Authorization Code flow and the `openid profile` scopes

## Setup

```sh
npm install
cp .env.example .env
```

Set these values in `.env`:

- `OIDC_ISSUER`: exact issuer URL advertised by the provider (without a trailing slash)
- `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`
- `APP_URL`: public base URL used by the browser, such as `http://localhost:3000`
- `SESSION_SECRET`: long random value used to sign the login cookie
- `PORT`: optional, defaults to `3000`
- `DATABASE_PATH`: optional SQLite file path, defaults to `./data.sqlite`

Register `${APP_URL}/callback` as an allowed redirect URI at the OIDC provider. The app discovers provider endpoints from `${OIDC_ISSUER}/.well-known/openid-configuration`, validates issuer, audience, signature and nonce in the ID token, and uses its `sub` claim as the account identity. Display names come from `name`, `preferred_username`, `email`, then `sub`.

## Run

```sh
npm start
```

Open `APP_URL` in a browser and choose **OIDCでログイン**. Login is required for posting and DM actions. The first logged-in member of a group is its creator. To add someone, that person must first log in once; enter their OIDC `sub` in the group's member form. A user's `sub` is visible to them only indirectly through the identity claim; the group owner can obtain it from the identity provider or their account administration. Group membership controls both reading and writing.

Private posts are excluded from the public timeline and queried only for their author. The SQLite database is created automatically on first run and persists across restarts. Log out clears the local signed session cookie.
