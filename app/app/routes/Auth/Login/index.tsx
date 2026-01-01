import { useState } from 'react';
import { data, redirect, useActionData, useNavigation, Link, type MetaFunction } from 'react-router';
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

export const meta: MetaFunction = () => {
  return [
    { title: 'Sign In | Memories' },
    { name: 'description', content: 'Sign in to your Memories account to access all features and content.' }
  ];
};

const Login = () => {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [showPassword, setShowPassword] = useState(false);
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div className="min-h-screen flex items-center justify-center p-4 ">
      <Card className="w-full max-w-md shadow-lg border-2 animate-in fade-in-0 zoom-in-95 duration-300">
        <CardHeader className="space-y-2 pb-6">
          <CardTitle className="text-3xl font-bold text-center bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            Welcome Back
          </CardTitle>
          <CardDescription className="text-center text-base">
            Sign in to continue to your account
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <form method="post" className="space-y-5">
            {actionData && 'error' in actionData && (
              <div className="p-4 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg animate-in slide-in-from-top-2 duration-200">
                {actionData.error}
              </div>
            )}
            
            <div className="space-y-2.5">
              <label htmlFor="identifier" className="text-sm font-semibold text-foreground">
                Username or Email
              </label>
              <Input
                id="identifier"
                name="identifier"
                type="text"
                required
                placeholder="Enter your username or email"
                autoComplete="username"
                className="w-full h-11 transition-all focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <div className="space-y-2.5">
              <label htmlFor="password" className="text-sm font-semibold text-foreground">
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
                  className="w-full h-11 pr-12 transition-all focus:ring-2 focus:ring-primary/20"
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

            <div className="flex items-center justify-end pt-1">
              <Link 
                to="/auth/reset" 
                className="text-sm text-primary hover:text-primary/80 font-medium transition-colors hover:underline"
              >
                Forgot password?
              </Link>
            </div>

            <Button 
              type="submit" 
              className="w-full h-11 text-base font-semibold shadow-md hover:shadow-lg transition-all" 
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>

          <div className="mt-6 pt-6 border-t border-border text-center">
            <span className="text-sm text-muted-foreground">Don't have an account? </span>
            <Link 
              to="/auth/signup" 
              className="text-sm text-primary hover:text-primary/80 font-semibold transition-colors hover:underline"
            >
              Create account
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
