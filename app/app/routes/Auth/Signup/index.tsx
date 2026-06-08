import { useState } from 'react';
import { data, redirect, useActionData, useNavigation, Link, type MetaFunction } from 'react-router';
import { buildPageMeta } from '~/lib/seo';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Card, CardContent, CardHeader } from '~/components/ui/card';
import { createUser } from '../fun/auth';
import { isAuthenticated } from '~/lib/Security/Password';
import { checkAuthRateLimit, resetAuthRateLimit } from '../fun/rateLimit';
import { issueVerifyContext, appendVerifyContextCookie } from '../fun/verification';
import { Eye, EyeOff, AlertCircle, User, Mail, Calendar, Lock } from 'lucide-react';

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

    const normalizedEmail = email?.toLowerCase() || '';

    const rateLimitCheck = checkAuthRateLimit(request, 'signup', normalizedEmail);
    if (!rateLimitCheck.allowed) {
      return data({ error: rateLimitCheck.error || 'Too many attempts. Please wait a bit and try again.' }, { status: 429 });
    }

    const result = await createUser({ username, email, password, dob });

    if (!result.success) {
      return data({ error: result.error || 'Something went wrong. Please try again.' }, { status: 400 });
    }

    resetAuthRateLimit(request, 'signup', email.toLowerCase());

    const ctxToken = await issueVerifyContext(result.userId!, 'signup');
    if (!ctxToken) {
      return data({ error: 'Something went wrong. Please try again.' }, { status: 500 });
    }
    const headers = new Headers();
    appendVerifyContextCookie(headers, ctxToken);
    return redirect('/auth/verify?type=signup', { headers });
  } catch (error) {
    console.error('Error in signup action:', error);
    return data({ error: 'Something went wrong. Please try again.' }, { status: 500 });
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
    <div className="w-full">
      <Card className="border-0 bg-transparent shadow-none">
        <CardHeader className="pb-1 pt-7 sm:pt-8 px-5 sm:px-8">
          <div className="text-center">
            <h1 className="text-xl font-semibold text-foreground">Create account</h1>
            <p className="mt-1 text-sm text-muted-foreground">Join Memories and start sharing</p>
          </div>
        </CardHeader>
        <CardContent className="px-5 sm:px-8 pb-6 sm:pb-8 pt-4">
          <form method="post" className="space-y-3.5">
            {actionData?.error && (
              <div className="flex items-start gap-2.5 rounded-lg bg-destructive/10 border border-destructive/20 px-3.5 py-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{actionData.error}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="username" className="text-sm font-medium text-foreground">Username</label>
              <div className="relative">
                <Input
                  id="username"
                  name="username"
                  type="text"
                  required
                  placeholder="Choose a username"
                  autoComplete="username"
                  className="w-full h-11 pl-10"
                />
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium text-foreground">Email</label>
              <div className="relative">
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  placeholder="Enter your email"
                  autoComplete="email"
                  className="w-full h-11 pl-10"
                />
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="dob" className="text-sm font-medium text-foreground">Date of birth</label>
              <div className="relative">
                <Input
                  id="dob"
                  name="dob"
                  type="date"
                  required
                  max={new Date(new Date().setFullYear(new Date().getFullYear() - 18)).toISOString().split('T')[0]}
                  className="w-full h-11 pl-10"
                />
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
              </div>
            </div>

            <div className="space-y-1.5">
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
                  className="w-full h-11 pl-10 pr-10"
                />
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
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
                  Creating account...
                </span>
              ) : (
                'Create account'
              )}
            </Button>
          </form>

          <div className="mt-6 pt-5 border-t border-border/60 text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link to="/auth/login" className="text-primary font-medium hover:underline transition-colors">
              Sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Signup;
