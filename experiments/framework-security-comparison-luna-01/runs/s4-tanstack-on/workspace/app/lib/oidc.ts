import { Issuer, generators, type Client } from 'openid-client'

let _client: Client | null = null

export async function getOIDCClient(): Promise<Client> {
  if (_client) return _client

  const issuerUrl = process.env['OIDC_ISSUER']
  const clientId = process.env['OIDC_CLIENT_ID']
  const clientSecret = process.env['OIDC_CLIENT_SECRET']
  const appUrl = process.env['APP_URL']

  if (!issuerUrl || !clientId || !clientSecret || !appUrl) {
    throw new Error('Missing required OIDC environment variables: OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, APP_URL')
  }

  const issuer = await Issuer.discover(issuerUrl)
  _client = new issuer.Client({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uris: [`${appUrl}/api/auth/callback`],
    response_types: ['code'],
  })

  return _client
}

export function generateState(): string {
  return generators.state()
}

export function generateNonce(): string {
  return generators.nonce()
}
