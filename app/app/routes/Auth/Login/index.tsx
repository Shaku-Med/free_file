import { useState } from 'react';
import { data, redirect, useActionData, useNavigation, Link } from 'react-router';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { loginUser } from '../fun/auth';
import { isAuthenticated } from '~/lib/Security/Password';

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

    if (!identifier || !password) {
      return data({ error: 'Username/email and password are required' }, { status: 400 });
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

    const url = new URL(request.url);
    const redirectTo = url.searchParams.get('redirect') || '/';
    
    const headers = new Headers();
    headers.append(
      'Set-Cookie',
      `c_user=${result.token}; Path=/; Max-Age=${30 * 24 * 60 * 60}; HttpOnly; ${process.env.NODE_ENV === 'production' ? 'Secure' : ''}; SameSite=Strict`
    );

    return redirect(redirectTo, { headers });
  } catch (error) {
    console.error('Error in login action:', error);
    return data({ error: 'An unexpected error occurred' }, { status: 500 });
  }
};

const Login = () => {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [showPassword, setShowPassword] = useState(false);
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">Welcome back</CardTitle>
          <CardDescription className="text-center">
            Enter your credentials to sign in
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form method="post" className="space-y-4">
            {actionData && 'error' in actionData && (
              <div className="p-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md">
                {actionData.error}
              </div>
            )}
            
            <div className="space-y-2">
              <label htmlFor="identifier" className="text-sm font-medium">
                Username or Email
              </label>
              <Input
                id="identifier"
                name="identifier"
                type="text"
                required
                placeholder="username or email@example.com"
                autoComplete="username"
                className="w-full"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-sm"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end">
              <Link to="/auth/reset" className="text-sm text-primary hover:underline">
                Forgot password?
              </Link>
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>

          <div className="mt-4 text-center text-sm">
            <span className="text-muted-foreground">Don't have an account? </span>
            <Link to="/auth/signup" className="text-primary hover:underline font-medium">
              Sign up
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
