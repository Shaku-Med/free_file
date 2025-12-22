import { useState } from 'react';
import { data, redirect, useActionData, useNavigation, Link, type MetaFunction } from 'react-router';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { createUser } from '../fun/auth';
import { isAuthenticated } from '~/lib/Security/Password';
import { checkAuthRateLimit, resetAuthRateLimit } from '../fun/rateLimit';

export const loader = async ({ request }: { request: Request }) => {
  const is_auth = await isAuthenticated(request);
  if (is_auth) {
    return redirect('/');
  }
  return data(null);
};

export const action = async ({ request }: { request: Request }) => {
  try {
    const formData = await request.formData();
    const username = formData.get('username') as string;
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    const dob = formData.get('dob') as string;

    // Validation is now handled in createUser, but we check rate limit first
    const normalizedEmail = email?.toLowerCase() || '';
    
    // Check rate limit
    const rateLimitCheck = checkAuthRateLimit(request, 'signup', normalizedEmail);
    if (!rateLimitCheck.allowed) {
      return data({ error: rateLimitCheck.error || 'Too many signup attempts. Please try again later.' }, { status: 429 });
    }

    const result = await createUser({ username, email, password, dob });

    if (!result.success) {
      return data({ error: result.error || 'Failed to create account' }, { status: 400 });
    }

    // Reset rate limit on successful signup
    resetAuthRateLimit(request, 'signup', email.toLowerCase());

    return redirect(`/auth/verify?userId=${result.userId}&email=${encodeURIComponent(email)}&type=signup`);
  } catch (error) {
    console.error('Error in signup action:', error);
    return data({ error: 'An unexpected error occurred' }, { status: 500 });
  }
};

export const meta: MetaFunction = () => {
  return [
    { title: 'Create Account | Memories' },
    { name: 'description', content: 'Create your Memories account to start sharing and discovering content.' }
  ];
};

const Signup = () => {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [showPassword, setShowPassword] = useState(false);
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-lg border-2 animate-in fade-in-0 zoom-in-95 duration-300">
        <CardHeader className="space-y-2 pb-6">
          <CardTitle className="text-3xl font-bold text-center bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            Create Account
          </CardTitle>
          <CardDescription className="text-center text-base">
            Join Memories and start your journey today
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <form method="post" className="space-y-5">
            {actionData?.error && (
              <div className="p-4 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg animate-in slide-in-from-top-2 duration-200">
                {actionData.error}
              </div>
            )}
            
            <div className="space-y-2.5">
              <label htmlFor="username" className="text-sm font-semibold text-foreground">
                Username
              </label>
              <Input
                id="username"
                name="username"
                type="text"
                required
                placeholder="Choose a username"
                autoComplete="username"
                className="w-full h-11 transition-all focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <div className="space-y-2.5">
              <label htmlFor="email" className="text-sm font-semibold text-foreground">
                Email
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                placeholder="Enter your email"
                autoComplete="email"
                className="w-full h-11 transition-all focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <div className="space-y-2.5">
              <label htmlFor="dob" className="text-sm font-semibold text-foreground">
                Date of Birth
              </label>
              <Input
                id="dob"
                name="dob"
                type="date"
                required
                max={new Date(new Date().setFullYear(new Date().getFullYear() - 18)).toISOString().split('T')[0]}
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
                  placeholder="Create a strong password"
                  autoComplete="new-password"
                  minLength={8}
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
              <p className="text-xs text-muted-foreground">Must be at least 8 characters</p>
            </div>

            <Button 
              type="submit" 
              className="w-full h-11 text-base font-semibold shadow-md hover:shadow-lg transition-all" 
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Creating account...' : 'Create Account'}
            </Button>
          </form>

          <div className="mt-6 pt-6 border-t border-border text-center">
            <span className="text-sm text-muted-foreground">Already have an account? </span>
            <Link 
              to="/auth/login" 
              className="text-sm text-primary hover:text-primary/80 font-semibold transition-colors hover:underline"
            >
              Sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Signup;
