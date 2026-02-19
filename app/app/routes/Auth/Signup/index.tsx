import { useState } from 'react';
import { data, redirect, useActionData, useNavigation, Link, type MetaFunction } from 'react-router';
import { buildPageMeta } from '~/lib/seo';
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

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: 'Create your free account | Memories',
    description: 'Create your Memories account to upload photos and videos, build a gallery, and discover content from other creators.',
    canonicalPath: '/auth/signup',
    noindex: true,
  });

const Signup = () => {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [showPassword, setShowPassword] = useState(false);
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div className="w-full max-w-md">
      <Card className="border shadow-sm">
        <CardHeader className="space-y-1 pb-4">
          <CardTitle className="text-2xl font-semibold text-center text-foreground">
            Create account
          </CardTitle>
          <CardDescription className="text-center text-muted-foreground">
            Sign up to get started
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form method="post" className="space-y-4">
            {actionData?.error && (
              <div className="p-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md">
                {actionData.error}
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="username" className="text-sm font-medium text-foreground">Username</label>
              <Input id="username" name="username" type="text" required placeholder="Choose a username" autoComplete="username" className="w-full" />
            </div>
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium text-foreground">Email</label>
              <Input id="email" name="email" type="email" required placeholder="Enter your email" autoComplete="email" className="w-full" />
            </div>
            <div className="space-y-2">
              <label htmlFor="dob" className="text-sm font-medium text-foreground">Date of birth</label>
              <Input
                id="dob"
                name="dob"
                type="date"
                required
                max={new Date(new Date().setFullYear(new Date().getFullYear() - 18)).toISOString().split('T')[0]}
                className="w-full"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium text-foreground">Password</label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  minLength={8}
                  className="w-full pr-12"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-sm">
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Creating account...' : 'Create account'}
            </Button>
          </form>

          <div className="mt-4 pt-4 border-t text-center text-sm text-muted-foreground">
            Already have an account? <Link to="/auth/login" className="text-foreground font-medium hover:underline">Sign in</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Signup;
