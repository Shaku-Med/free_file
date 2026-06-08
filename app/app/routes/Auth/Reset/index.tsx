import { useState } from 'react';
import { data, redirect, useActionData, useNavigation, Link, type MetaFunction } from 'react-router';
import { buildPageMeta } from '~/lib/seo';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Card, CardContent, CardHeader } from '~/components/ui/card';
import { isAuthenticated } from '~/lib/Security/Password';
import db from '~/lib/Database/supabase';
import crypto from 'crypto';
import { generateVerificationCode, hashVerificationCode, saveVerificationCode, issueVerifyContext, appendVerifyContextCookie } from '../fun/verification';
import { sendVerificationEmail } from '../fun/email';
import { checkAuthRateLimit, resetAuthRateLimit } from '../fun/rateLimit';
import { normalizeIdentifier, sanitizeString, isValidEmail, constantTimeDelay } from '../fun/validation';
import { KeyRound, AlertCircle, ArrowLeft } from 'lucide-react';

async function redirectToVerifyReset(userId: string): Promise<Response> {
  const token = await issueVerifyContext(userId, 'reset');
  const headers = new Headers();
  if (token) appendVerifyContextCookie(headers, token);
  return redirect('/auth/verify?type=reset', { headers });
}

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
      return data({ error: rateLimitCheck.error || 'Too many attempts. Please wait a bit and try again.' }, { status: 429 });
    }

    if (!db) {
      return data({ error: 'Something went wrong. Please try again.' }, { status: 500 });
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
      // Enumeration-safe: issue a context for a non-resolvable id so the
      // verify page renders identically to the real path.
      await constantTimeDelay();
      return redirectToVerifyReset(crypto.randomUUID());
    }

    const code = generateVerificationCode();
    const codeHash = await hashVerificationCode(code);

    if (!codeHash) {
      return data({ error: 'Something went wrong. Please try again.' }, { status: 500 });
    }

    const saved = await saveVerificationCode(user.id, codeHash, 1);
    if (!saved) {
      return data({ error: 'Something went wrong. Please try again.' }, { status: 500 });
    }

    const emailSent = await sendVerificationEmail(user.email, code, 'reset');
    if (!emailSent) {
      return data({ error: 'Something went wrong. Please try again.' }, { status: 500 });
    }

    resetAuthRateLimit(request, 'reset', identifier.toLowerCase());

    return redirectToVerifyReset(user.id);
  } catch (error) {
    console.error('Error in reset action:', error);
    return data({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
};

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: 'Reset your password | Memories',
    description: 'Reset your Memories account password to regain access to your account and content.',
    canonicalPath: '/auth/reset',
    noindex: true,
  });

const Reset = () => {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div className="w-full">
      <Card className="border-0 bg-transparent shadow-none">
        <CardHeader className="pb-1 pt-7 sm:pt-8 px-5 sm:px-8">
          <div className="flex flex-col items-center gap-2">
            <KeyRound className="h-8 w-8 text-primary" />
            <div className="text-center">
              <h1 className="text-xl font-semibold text-foreground">Forgot your password?</h1>
              <p className="mt-1 text-sm text-muted-foreground">No worries, we'll send you a code to reset it</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-5 sm:px-8 pb-6 sm:pb-8 pt-4">
          <form method="post" className="space-y-3.5">
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
                />
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
              </div>
            </div>

            <Button type="submit" className="w-full h-11 font-medium" disabled={isSubmitting}>
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Sending code...
                </span>
              ) : (
                'Send reset code'
              )}
            </Button>
          </form>

          <div className="mt-5 pt-5 border-t border-border/60 text-center text-sm">
            <Link to="/auth/login" className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-primary transition-colors">
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Reset;
