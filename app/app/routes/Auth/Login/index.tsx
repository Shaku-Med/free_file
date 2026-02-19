import { useState } from 'react';
import { data, redirect, useActionData, useNavigation, Link, type MetaFunction } from 'react-router';
import { buildPageMeta } from '~/lib/seo';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { loginUser } from '../fun/auth';
import { isAuthenticated } from '~/lib/Security/Password';
import { checkAuthRateLimit, resetAuthRateLimit } from '../fun/rateLimit';

export const loader = async ({ request }: { request: Request }) => {
  const is_auth = await isAuthenticated(request);
  if (is_auth) {
    const url = new URL(request.url);
    const searchParams = url.searchParams.toString();
    const redirectUrl = searchParams ? `/?${searchParams}` : '/';
    return redirect(redirectUrl);
  }
  return data(null);
};

export const action = async ({ request }: { request: Request }) => {
  try {
    const formData = await request.formData();
    const identifier = formData.get('identifier') as string;
    const password = formData.get('password') as string;

    // Validation is handled in loginUser, but check rate limit first
    const normalizedIdentifier = identifier?.toLowerCase() || '';
    
    // Check rate limit
    const rateLimitCheck = checkAuthRateLimit(request, 'login', normalizedIdentifier);
    if (!rateLimitCheck.allowed) {
      return data({ error: rateLimitCheck.error || 'Too many login attempts. Please try again later.' }, { status: 429 });
    }

    const result = await loginUser({ identifier, password }, request);

    if (!result.success) {
      if (result.needsVerification && result.userId && result.email) {
        return redirect(`/auth/verify?userId=${result.userId}&email=${encodeURIComponent(result.email)}&type=signup`);
      }
      return data({ error: result.error || 'Invalid credentials' }, { status: 401 });
    }

    if (!result.token) {
      return data({ error: 'Failed to create session' }, { status: 500 });
    }

    // Reset rate limit on successful login
    resetAuthRateLimit(request, 'login', identifier.toLowerCase());

    const url = new URL(request.url);
    const redirectTo = url.searchParams.get('redirect') || '/';
    
    // For cross-site cookie sharing with image server, use SameSite=None in production
    // SameSite=None requires Secure flag (HTTPS only)
    const sameSite = process.env.NODE_ENV === 'production' ? 'SameSite=None' : 'SameSite=Lax';
    const secure = process.env.NODE_ENV === 'production' ? 'Secure' : '';
    
    const headers = new Headers();
    headers.append(
      'Set-Cookie',
      `c_user=${result.token}; Path=/; Max-Age=${30 * 24 * 60 * 60}; HttpOnly; ${secure}; ${sameSite}`
    );

    return redirect(redirectTo, { headers });
  } catch (error) {
    console.error('Error in login action:', error);
    return data({ error: 'An unexpected error occurred' }, { status: 500 });
  }
};

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: 'Sign In | Memories',
    description: 'Sign in to your Memories account to access all features and content.',
    canonicalPath: '/auth/login',
    noindex: true,
  });

const Login = () => {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [showPassword, setShowPassword] = useState(false);
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div className="w-full max-w-md">
      <Card className="border shadow-sm">
        <CardHeader className="space-y-1 pb-4">
          <CardTitle className="text-2xl font-semibold text-center text-foreground">
            Sign in
          </CardTitle>
          <CardDescription className="text-center text-muted-foreground">
            Sign in to continue to your account
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form method="post" className="space-y-4">
            {actionData && 'error' in actionData && (
              <div className="p-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md">
                {actionData.error}
              </div>
            )}
            
            <div className="space-y-2">
              <label htmlFor="identifier" className="text-sm font-medium text-foreground">
                Username or email
              </label>
              <Input
                id="identifier"
                name="identifier"
                type="text"
                required
                placeholder="Enter your username or email"
                autoComplete="username"
                className="w-full"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium text-foreground">
                Password
              </label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  className="w-full pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end">
              <Link to="/auth/reset" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
                Forgot password?
              </Link>
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>

          <div className="mt-4 pt-4 border-t text-center text-sm text-muted-foreground">
            Don't have an account? <Link to="/auth/signup" className="text-foreground font-medium hover:underline">Create account</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default Login;
