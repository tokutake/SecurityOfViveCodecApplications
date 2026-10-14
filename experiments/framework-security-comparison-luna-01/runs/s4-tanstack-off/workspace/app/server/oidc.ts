import { Issuer, generators, type IdTokenClaims } from 'openid-client'

let _client: InstanceType<InstanceType<typeof Issuer>['Client']> | null = null

async function getOidcClient() {
  if (_client) return _client
  const issuer = await Issuer.discover(process.env.OIDC_ISSUER!)
  _client = new issuer.Client({
    client_id: process.env.OIDC_CLIENT_ID!,
    client_secret: process.env.OIDC_CLIENT_SECRET!,
    response_types: ['code'],
  })
  return _client
}

export async function buildAuthUrl(redirectUri: string) {
  const client = await getOidcClient()
  const codeVerifier = generators.codeVerifier()
  const codeChallenge = generators.codeChallenge(codeVerifier)
  const state = generators.state()

  const url = client.authorizationUrl({
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  })

  return { url: new URL(url), codeVerifier, state }
}

export interface OidcClaims {
  sub: string
  name?: string
  preferred_username?: string
  email?: string
}

export async function exchangeCode(
  requestUrl: string,
  codeVerifier: string,
  state: string,
  redirectUri: string,
): Promise<OidcClaims> {
  const client = await getOidcClient()
  const params = client.callbackParams(requestUrl)
  const tokenSet = await client.callback(redirectUri, params, {
    code_verifier: codeVerifier,
    state,
  })
  const claims = tokenSet.claims() as IdTokenClaims & OidcClaims

  return {
    sub: claims.sub,
    name: claims.name as string | undefined,
    preferred_username: claims.preferred_username,
    email: claims.email,
  }
}

export function getDisplayName(claims: OidcClaims): string {
  return claims.name || claims.preferred_username || claims.email || claims.sub
}
