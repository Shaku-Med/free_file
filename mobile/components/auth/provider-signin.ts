import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

/**
 * Base URL of the Memories web app. Point this at your deployment
 * (or a LAN IP during local dev, e.g. http://192.168.1.10:3000).
 */
export const AUTH_BASE_URL = 'https://memories.example.com';

export type AuthProvider = 'web';

export type AuthResult =
  | { type: 'success'; token: string }
  | { type: 'cancel' }
  | { type: 'dismiss' }
  | { type: 'error'; message: string };

/**
 * Opens the web app's login page inside an in-app browser session and
 * resolves once the site redirects back to our app via a deep link.
 *
 * Expected web app contract:
 *   GET {AUTH_BASE_URL}/auth/login?redirect={redirectUri}
 *     on success, 302 to {redirectUri}?token=...
 */
export async function signInWithProvider(_provider: AuthProvider): Promise<AuthResult> {
  const redirectUri = Linking.createURL('auth/callback');
  const startUrl = `${AUTH_BASE_URL}/auth/login?redirect=${encodeURIComponent(redirectUri)}`;

  try {
    const result = await WebBrowser.openAuthSessionAsync(startUrl, redirectUri);

    if (result.type === 'success' && result.url) {
      const { queryParams } = Linking.parse(result.url);
      const token = typeof queryParams?.token === 'string' ? queryParams.token : null;
      if (!token) return { type: 'error', message: 'Missing token in callback' };
      return { type: 'success', token };
    }

    if (result.type === 'cancel') return { type: 'cancel' };
    return { type: 'dismiss' };
  } catch (e) {
    return { type: 'error', message: e instanceof Error ? e.message : 'Unknown error' };
  }
}
