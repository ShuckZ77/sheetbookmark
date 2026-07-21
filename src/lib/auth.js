import { api, sessionStore } from './browser.js';
import { CLIENT_ID, SCOPES, isConfiguredBuild } from '../config.js';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPE = SCOPES.join(' ');
const TOKEN_KEY = 'accessToken';

/** Treat a token as expired a minute early so an in-flight request cannot straddle the boundary. */
const EXPIRY_SKEW_MS = 60_000;

export class AuthError extends Error {
  constructor(message, { needsInteraction = false } = {}) {
    super(message);
    this.name = 'AuthError';
    this.needsInteraction = needsInteraction;
  }
}

/**
 * Chromium's redirect URL is `https://<extension-id>.chromiumapp.org/`, which Google
 * accepts because Google owns that domain. Firefox's is `https://<hash>.extensions.allizom.org/`,
 * which Google *rejects* — registering it would mean proving ownership of Mozilla's domain.
 * Firefox 86 added a loopback form built from the same subdomain as the escape hatch, and
 * launchWebAuthFlow intercepts it internally with no server listening. See Bugzilla 1635344.
 */
export function toGoogleRedirectUri(redirectUrl) {
  const { hostname } = new URL(redirectUrl);
  if (!hostname.endsWith('.extensions.allizom.org')) return redirectUrl;
  return `http://127.0.0.1/mozoauth2/${hostname.split('.')[0]}`;
}

export const getRedirectUri = () => toGoogleRedirectUri(api.identity.getRedirectURL());

/**
 * The implicit flow: Google hands back an access token in the redirect fragment.
 * There is no refresh token, and therefore no client secret to hide anywhere.
 * `prompt=none` makes the silent path fail fast rather than show UI in a hidden window.
 */
function buildAuthUrl({ interactive, state }) {
  const params = {
    client_id: CLIENT_ID,
    response_type: 'token',
    redirect_uri: getRedirectUri(),
    scope: SCOPE,
    state,
  };
  // Silent renewal must fail fast rather than show UI in a hidden window. Interactive
  // auth deliberately omits `prompt`: Google then shows only what is actually needed —
  // full consent on first grant, a bare account confirmation on later sign-ins.
  if (!interactive) params.prompt = 'none';

  const url = new URL(AUTH_ENDPOINT);
  url.search = new URLSearchParams(params).toString();
  return url.toString();
}

async function readCachedToken() {
  const { [TOKEN_KEY]: cached } = await sessionStore.get(TOKEN_KEY);
  if (!cached?.token || cached.expiresAt - EXPIRY_SKEW_MS <= Date.now()) return null;
  return cached.token;
}

export async function invalidateToken() {
  await sessionStore.remove(TOKEN_KEY);
}

async function launchFlow(interactive) {
  const state = crypto.randomUUID();

  let redirect;
  try {
    redirect = await api.identity.launchWebAuthFlow({
      url: buildAuthUrl({ interactive, state }),
      interactive,
    });
  } catch (error) {
    throw new AuthError(error?.message ?? 'Authorization failed', { needsInteraction: !interactive });
  }

  if (!redirect) throw new AuthError('Authorization was cancelled', { needsInteraction: !interactive });

  const url = new URL(redirect);
  const params = new URLSearchParams(url.hash.slice(1));

  const failure = params.get('error') ?? url.searchParams.get('error');
  if (failure) throw new AuthError(`Google returned "${failure}"`, { needsInteraction: !interactive });

  if (params.get('state') !== state) throw new AuthError('Authorization state did not match');

  const token = params.get('access_token');
  if (!token) throw new AuthError('Google returned no access token', { needsInteraction: !interactive });

  const lifetimeSeconds = Number(params.get('expires_in')) || 3600;
  await sessionStore.set({ [TOKEN_KEY]: { token, expiresAt: Date.now() + lifetimeSeconds * 1000 } });
  return token;
}

/**
 * Returns a usable access token, renewing it silently against the browser's Google
 * session when it can. Only escalates to a visible window when `interactive` is set;
 * otherwise it raises an AuthError the caller surfaces as a "sign in" prompt.
 */
export async function getToken({ interactive = false } = {}) {
  const cached = await readCachedToken();
  if (cached) return cached;

  if (!isConfiguredBuild()) {
    throw new AuthError('This build has no Google client ID configured', { needsInteraction: true });
  }

  try {
    return await launchFlow(false);
  } catch {
    if (!interactive) throw new AuthError('Google sign-in required', { needsInteraction: true });
  }

  return launchFlow(true);
}
