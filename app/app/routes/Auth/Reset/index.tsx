import { useState } from 'react';
import { data, redirect, useActionData, useNavigation, Link, type MetaFunction } from 'react-router';
import { buildPageMeta } from '~/lib/seo';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { isAuthenticated } from '~/lib/Security/Password';
import db from '~/lib/Database/supabase';
import { generateVerificationCode, hashVerificationCode, saveVerificationCode } from '../fun/verification';
import { sendVerificationEmail } from '../fun/email';
import { checkAuthRateLimit, resetAuthRateLimit } from '../fun/rateLimit';
import { normalizeIdentifier, sanitizeString, isValidEmail, constantTimeDelay } from '../fun/validation';

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
    const identifier = formData.get('identifier') as string;

    if (!identifier || !identifier.trim()) {
      return data({ error: 'Please enter your username or email.' }, { status: 400 });
    }

    const sanitized = sanitizeString(identifier, 320);
    const normalized = normalizeIdentifier(sanitized);

    if (normalized.length < 3) {
      return data({ error: 'Please enter a valid username or email.' }, { status: 400 });
    }

    const rateLimitCheck = checkAuthRateLimit(request, 'reset', normalized);
    if (!rateLimitCheck.allowed) {
      return data({ error: rateLimitCheck.error || 'Too many reset attempts. Please try again later.' }, { status: 429 });
    }

    if (!db) {
      return data({ error: 'Service temporarily unavailable. Please try again later.' }, { status: 500 });
    }

    const isEmail = normalized.includes('@');
    let user = null;

    if (isEmail) {
      if (!isValidEmail(normalized)) {
        return data({ error: 'Please enter a valid email address.' }, { status: 400 });
      }
      const { data: userData, error } = await db
        .from('users')
        .select('id, email, is_memories')
        .eq('email', normalized)
        .maybeSingle();
      if (!error && userData && !userData.is_memories) user = userData;
    } else {
      const { data: userData, error } = await db
        .from('users')
        .select('id, email, is_memories')
        .eq('username', normalized)
        .maybeSingle();
      if (!error && userData && !userData.is_memories) user = userData;
    }

    if (!user) {
      return data({ error: 'No account found with that username or email.' }, { status: 404 });
    }

    const code = generateVerificationCode();
    const codeHash = await hashVerificationCode(code);
    
    if (!codeHash) {
      return data({ error: 'Failed to generate verification code' }, { status: 500 });
    }

    const saved = await saveVerificationCode(user.id, codeHash, 1);
    if (!saved) {
      return data({ error: 'Failed to save verification code' }, { status: 500 });
    }

    const emailSent = await sendVerificationEmail(user.email, code, 'reset');
    if (!emailSent) {
      return data({ error: 'Failed to send verification email' }, { status: 500 });
    }

    // Reset rate limit on successful reset request
    resetAuthRateLimit(request, 'reset', identifier.toLowerCase());

    return redirect(`/auth/verify?userId=${user.id}&type=reset`);
  } catch (error) {
    console.error('Error in reset action:', error);
    return data({ error: 'An unexpected error occurred' }, { status: 500 });
  }
};

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: 'Reset Password | Memories',
    description: 'Reset your Memories account password to regain access to your account.',
    canonicalPath: '/auth/reset',
    noindex: true,
  });

const Reset = () => {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div className="w-full max-w-md">
      <Card className="border shadow-sm">
        <CardHeader className="space-y-1 pb-4">
          <CardTitle className="text-2xl font-semibold text-center text-foreground">
            Reset password
          </CardTitle>
          <CardDescription className="text-center text-muted-foreground">
            Enter your username or email to receive a verification code
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

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Sending code...' : 'Send code'}
            </Button>
          </form>

          <div className="mt-4 pt-4 border-t text-center text-sm">
            <Link to="/auth/login" className="text-muted-foreground hover:text-foreground hover:underline">
              Back to sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Reset;

