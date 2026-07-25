import { useState } from 'react';
import {
  data,
  redirect,
  useActionData,
  useNavigation,
  Link,
  useSearchParams,
  useLoaderData,
  type MetaFunction,
} from 'react-router';
import { buildPageMeta } from '~/lib/seo';
import { Button } from '~/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar';
import { Input } from '~/components/ui/input';
import { Card, CardContent, CardHeader } from '~/components/ui/card';
import { loginUser, appendSessionCookie } from '../fun/auth';
import { isAuthenticated } from '~/lib/Security/Password';
import { getCookie } from '~/lib/Security/Token';
import {
  appendAltAccountsCookie,
  parkCurrentInVault,
  readAltAccountsFromRequest,
  safeServerRedirect,
} from '~/lib/Security/accountVault';
import { PasskeyUserMessage, friendlyPasskeyClientError } from '~/lib/webauthn/userMessages';
import { checkAuthRateLimit, resetAuthRateLimit } from '../fun/rateLimit';
import { isCrossOriginForgery } from '~/lib/Security/requestOrigin';
import { issueVerifyContext, appendVerifyContextCookie } from '../fun/verification';
import { getProfilePicUrl } from '~/lib/utils/profilePic';
import { Eye, EyeOff, AlertCircle, Fingerprint, KeyRound, CheckCircle2, Users } from 'lucide-react';

export const loader = async ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  const addAccount = url.searchParams.get('addAccount') === '1';
  const is_auth = await isAuthenticated(request);
  if (is_auth && !addAccount) {
    const searchParams = url.searchParams.toString();
    const redirectUrl = searchParams ? `/?${searchParams}` : '/';
    return redirect(redirectUrl);
  }
  const alt = readAltAccountsFromRequest(request.headers);
  const altAccounts = alt.map(({ id, u, pic }) => ({
    id,
    username: u,
    profile_pic: pic ?? null,
  }));
  return data({ addAccount: Boolean(is_auth && addAccount), altAccounts });
};

export const action = async ({ request }: { request: Request }) => {
  try {
    if (isCrossOriginForgery(request)) {
      return data({ error: 'Invalid request origin.' }, { status: 403 });
    }
    const formData = await request.formData();
    const identifier = formData.get('identifier') as string;
    const password = formData.get('password') as string;
    const addAccount = formData.get('addAccount') === '1';

    const normalizedIdentifier = identifier?.toLowerCase() || '';

    // Per-IP cap first (stops password spraying across many accounts), then
    // the tighter per-identifier cap.
    const ipLimit = checkAuthRateLimit(request, 'login_ip');
    if (!ipLimit.allowed) {
      return data({ error: ipLimit.error || 'Too many attempts. Please wait a bit and try again.' }, { status: 429 });
    }
    const rateLimitCheck = checkAuthRateLimit(request, 'login', normalizedIdentifier);
    if (!rateLimitCheck.allowed) {
      return data({ error: rateLimitCheck.error || 'Too many attempts. Please wait a bit and try again.' }, { status: 429 });
    }

    const oldToken = addAccount ? getCookie('c_user', request.headers) : null;
    const oldUser =
      addAccount && oldToken ? await isAuthenticated(request, ['id', 'username', 'profile_pic']) : null;

    const result = await loginUser({ identifier, password }, request);

    if (!result.success) {
      if (result.needsVerification && result.userId) {
        const ctxToken = await issueVerifyContext(result.userId, 'signup');
        if (!ctxToken) {
          return data({ error: 'Something went wrong. Please try again.' }, { status: 500 });
        }
        const headers = new Headers();
        appendVerifyContextCookie(headers, ctxToken);
        return redirect('/auth/verify?type=signup', { headers });
      }
      return data({ error: result.error || 'Incorrect username or password. Please try again.' }, { status: 401 });
    }

    if (!result.token || !result.userId) {
      return data({ error: 'Something went wrong. Please try again.' }, { status: 500 });
    }

    resetAuthRateLimit(request, 'login', identifier.toLowerCase());

    const url = new URL(request.url);
    const redirectTo = safeServerRedirect(request, url.searchParams.get('redirect'));

    let vault = readAltAccountsFromRequest(request.headers);
    // Drop any stale parked session for the account that just logged in.
    const hadStaleEntry = vault.some((a) => a.id === result.userId);
    vault = vault.filter((a) => a.id !== result.userId);
    if (addAccount && oldToken && oldUser) {
      vault = parkCurrentInVault(vault, oldToken, {
        id: oldUser.id,
        username: oldUser.username,
        profile_pic: oldUser.profile_pic,
      }, result.userId);
    }

    const headers = new Headers();
    appendSessionCookie(headers, result.token);
    if ((addAccount && oldToken && oldUser) || hadStaleEntry) {
      appendAltAccountsCookie(headers, vault);
    }

    return redirect(redirectTo, { headers });
  } catch (error) {
    console.error('Error in login action:', error);
    return data({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
};

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: 'Sign In to your account | Memories',
    description: 'Sign in to your Memories account to view your feed, upload content, and access your saved playlists and profile.',
    canonicalPath: '/auth/login',
    noindex: true,
  });

function safeClientRedirect(path: string | null): string {
  // Must be a same-origin absolute path. Reject protocol-relative ("//host")
  // and backslash tricks ("/\\host") that browsers normalize to off-site URLs.
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return '/';
  return path.length > 500 ? '/' : path;
}

const Login = () => {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const loaderData = useLoaderData<typeof loader>();
  const { addAccount, altAccounts } = loaderData;
  const [showPassword, setShowPassword] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeyPending, setPasskeyPending] = useState(false);
  const [switchPending, setSwitchPending] = useState<string | null>(null);
  const [identifierValue, setIdentifierValue] = useState('');
  const [passwordPromptFor, setPasswordPromptFor] = useState<string | null>(null);
  const isSubmitting = navigation.state === 'submitting';
  const redirectAfterLogin = safeClientRedirect(searchParams.get('redirect'));
  const justVerified = searchParams.get('verified') === 'true';
  const justResetPassword = searchParams.get('passwordReset') === 'true';
  const addAccountParam = searchParams.get('addAccount') === '1';

  // Prefill the username and focus the password field.
  const promptPasswordFor = (username: string) => {
    setIdentifierValue(username);
    setPasswordPromptFor(username);
    setPasskeyError(null);
    requestAnimationFrame(() => {
      (document.getElementById('password') as HTMLInputElement | null)?.focus();
    });
  };

  // Authenticated visitors get the token switch; otherwise (401/403) fall back to password login.
  const switchToAccount = async (acc: { id: string; username: string }) => {
    setSwitchPending(acc.id);
    setPasskeyError(null);
    setPasswordPromptFor(null);
    try {
      const res = await fetch('/api/auth/switch-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userId: acc.id }),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          promptPasswordFor(acc.username);
          return;
        }
        const payload = await res.json().catch(() => ({}));
        setPasskeyError(
          typeof payload?.error === 'string' ? payload.error : 'Could not switch account.'
        );
        return;
      }
      window.location.assign(redirectAfterLogin);
    } catch {
      setPasskeyError('Could not switch account.');
    } finally {
      setSwitchPending(null);
    }
  };

  const signInWithPasskey = async () => {
    setPasskeyError(null);
    setPasskeyPending(true);
    try {
      const identifierEl = document.getElementById('identifier') as HTMLInputElement | null;
      const identifierRaw = identifierEl?.value?.trim();
      const { startAuthentication } = await import('@simplewebauthn/browser');
      const optRes = await fetch('/api/webauthn/login-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(identifierRaw ? { identifier: identifierRaw } : {}),
      });
      const optPayload = await optRes.json().catch(() => ({}));
      if (!optRes.ok) {
        setPasskeyError(
          typeof optPayload?.error === 'string' ? optPayload.error : PasskeyUserMessage.loginStartFailed
        );
        return;
      }
      const { flowId, options } = optPayload;
      if (!flowId || !options) {
        setPasskeyError(PasskeyUserMessage.loginStartFailed);
        return;
      }
      const assertion = await startAuthentication({ optionsJSON: options });
      const verifyRes = await fetch('/api/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          flowId,
          response: assertion,
          redirect: redirectAfterLogin,
          addAccount: addAccountParam,
        }),
      });
      const verifyPayload = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok) {
        setPasskeyError(
          typeof verifyPayload?.error === 'string' ? verifyPayload.error : PasskeyUserMessage.loginDidNotWork
        );
        return;
      }
      const next = safeClientRedirect(verifyPayload?.redirect ?? redirectAfterLogin);
      window.location.assign(next);
    } catch (e) {
      setPasskeyError(friendlyPasskeyClientError(e));
    } finally {
      setPasskeyPending(false);
    }
  };

  return (
    <div className="w-full">
      {justVerified && (
        <div className="mb-4 flex items-center gap-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>Email verified! You can now sign in.</span>
        </div>
      )}

      {justResetPassword && (
        <div className="mb-4 flex items-center gap-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>Password updated! Sign in with your new password.</span>
        </div>
      )}

      <Card className="border-0 bg-transparent shadow-none">
        <CardHeader className="pb-1 pt-7 sm:pt-8 px-5 sm:px-8">
          <div className="text-center">
            <h1 className="text-xl font-semibold text-foreground">
              {addAccount ? 'Add another account' : 'Welcome back'}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {addAccount
                ? 'Sign in with a different username or email. Your current session will be saved so you can switch back.'
                : 'Sign in to continue to your account'}
            </p>
          </div>
        </CardHeader>
        <CardContent className="px-5 sm:px-8 pb-6 sm:pb-8 pt-4">
          {!addAccount && altAccounts.length > 0 && (
            <div className="mb-5 space-y-2">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" />
                Saved accounts on this device
              </p>
              <div className="flex flex-col gap-2">
                {altAccounts.map((acc) => (
                  <Button
                    key={acc.id}
                    type="button"
                    variant="outline"
                    className="w-full justify-start h-auto py-2.5 px-3 gap-2.5"
                    disabled={!!switchPending}
                    onClick={() => void switchToAccount(acc)}
                  >
                    {switchPending === acc.id ? (
                      <span className="flex items-center gap-2 text-sm">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        Switching…
                      </span>
                    ) : (
                      <>
                        <Avatar className="h-8 w-8 shrink-0 ring-1 ring-border">
                          <AvatarImage src={getProfilePicUrl(acc.profile_pic ?? undefined)} alt="" />
                          <AvatarFallback className="text-xs bg-primary/10 text-primary font-medium">
                            {acc.username.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-medium text-left truncate">{acc.username}</span>
                      </>
                    )}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <form method="post" className="space-y-3.5">
            {addAccount && <input type="hidden" name="addAccount" value="1" />}
            {passwordPromptFor && (
              <div className="flex items-start gap-2.5 rounded-lg bg-primary/10 border border-primary/20 px-3.5 py-3 text-sm text-foreground">
                <KeyRound className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  Enter the password for <span className="font-medium">{passwordPromptFor}</span> to sign back in.
                </span>
              </div>
            )}
            {actionData && 'error' in actionData && (
              <div className="flex items-start gap-2.5 rounded-lg bg-destructive/10 border border-destructive/20 px-3.5 py-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{actionData.error}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="identifier" className="text-sm font-medium text-foreground">
                Username or email
              </label>
              <div className="relative">
                <Input
                  id="identifier"
                  name="identifier"
                  type="text"
                  required
                  placeholder="Enter your username or email"
                  autoComplete="username"
                  className="w-full h-11 pl-10"
                  value={identifierValue}
                  onChange={(e) => setIdentifierValue(e.target.value)}
                />
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-sm font-medium text-foreground">
                  Password
                </label>
                <Link to="/auth/reset" className="text-xs text-muted-foreground hover:text-primary transition-colors">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  className="w-full h-11 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" className="w-full h-11 font-medium" disabled={isSubmitting}>
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  {addAccount ? 'Adding account…' : 'Signing in...'}
                </span>
              ) : addAccount ? (
                'Add account'
              ) : (
                'Sign in'
              )}
            </Button>
          </form>

          {passkeyError && (
            <div className="mt-3 flex items-start gap-2.5 rounded-lg bg-destructive/10 border border-destructive/20 px-3.5 py-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{passkeyError}</span>
            </div>
          )}

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border/60" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-background px-3 text-muted-foreground">or</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full h-11"
            disabled={isSubmitting || passkeyPending}
            onClick={() => void signInWithPasskey()}
          >
            {passkeyPending ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Waiting for passkey...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Fingerprint className="h-4 w-4" />
                Sign in with passkey
              </span>
            )}
          </Button>

          <div className="mt-6 pt-5 border-t border-border/60 text-center text-sm text-muted-foreground">
            Don't have an account?{' '}
            <Link to="/auth/signup" className="text-primary font-medium hover:underline transition-colors">
              Create account
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default Login;
