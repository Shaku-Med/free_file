import { useState, useEffect, useRef } from 'react';
import { data, redirect, useActionData, useLoaderData, useNavigation, useSearchParams, Link, type MetaFunction } from 'react-router';
import { buildPageMeta } from '~/lib/seo';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Card, CardContent, CardHeader } from '~/components/ui/card';
import {
  getVerificationRecord,
  verifyCode,
  isVerificationCodeExpired,
  deleteVerificationRecord,
  generateResetToken,
  incrementVerificationAttempts,
  readVerifyContext,
  clearVerifyContextCookie,
} from '../fun/verification';
import { resendVerificationCode } from '../fun/auth';
import db from '~/lib/Database/supabase';
import { isAuthenticated } from '~/lib/Security/Password';
import { checkAuthRateLimit, resetAuthRateLimit } from '../fun/rateLimit';
import { isValidVerificationCode, constantTimeDelay } from '../fun/validation';
import { MailCheck, AlertCircle, CheckCircle2, ArrowLeft, RefreshCw } from 'lucide-react';

const MAX_CODE_ATTEMPTS = 5;

export const loader = async ({ request }: { request: Request }) => {
  const is_auth = await isAuthenticated(request);
  if (is_auth) {
    return redirect('/');
  }

  // userId/type come from the signed HttpOnly cookie, NOT the URL  the URL
  // ?userId= is ignored so it can't be edited to target another account.
  const ctx = await readVerifyContext(request);
  if (!ctx) {
    return redirect('/auth/login');
  }

  if (!db) {
    return redirect('/auth/login');
  }

  const { data: user, error: userError } = await db
    .from('users')
    .select('email, is_memories')
    .eq('id', ctx.userId)
    .maybeSingle();

  // Reset flow stays enumeration-safe: a non-resolvable id (fake reset
  // request for an account that doesn't exist) still renders the page with a
  // generic label rather than redirecting, so it's indistinguishable.
  if (userError || !user || user.is_memories) {
    if (ctx.type === 'reset') {
      return data({ email: '', type: ctx.type });
    }
    return redirect('/auth/login');
  }

  return data({ email: maskEmail(user.email), type: ctx.type });
};

function maskEmail(email: unknown): string {
  if (typeof email !== 'string' || !email.includes('@')) return '';
  const [local, domain] = email.split('@');
  const head = local.slice(0, 2);
  return `${head}${'*'.repeat(Math.min(Math.max(local.length - head.length, 1), 5))}@${domain}`;
}

export const action = async ({ request }: { request: Request }) => {
  try {
    const formData = await request.formData();
    const code = formData.get('code') as string;
    const actionType = formData.get('actionType') as string;

    // Trust ONLY the signed cookie for identity. Form/URL userId is ignored.
    const ctx = await readVerifyContext(request);
    if (!ctx) {
      return data({ error: 'Your session expired. Please start again.' }, { status: 401 });
    }
    const { userId, type } = ctx;

    if (actionType === 'resend') {
      const rateLimitCheck = checkAuthRateLimit(request, 'resend', userId);
      if (!rateLimitCheck.allowed) {
        return data({ error: rateLimitCheck.error || 'Too many attempts. Please wait a bit and try again.' }, { status: 429 });
      }

      const result = await resendVerificationCode(userId, type);
      if (!result.success) {
        return data({ error: result.error || 'Something went wrong. Please try again.' }, { status: 400 });
      }

      resetAuthRateLimit(request, 'resend', userId);
      return data({ success: true, message: 'A new code has been sent to your email.' });
    }

    if (!code || !isValidVerificationCode(code)) {
      await constantTimeDelay();
      return data({ error: 'Please enter the 6-digit code from your email.' }, { status: 400 });
    }

    const rateLimitCheck = checkAuthRateLimit(request, 'verify', userId);
    if (!rateLimitCheck.allowed) {
      return data({ error: rateLimitCheck.error || 'Too many attempts. Please wait a bit and try again.' }, { status: 429 });
    }

    if (!db) {
      return data({ error: 'Something went wrong. Please try again.' }, { status: 500 });
    }

    const { data: user } = await db
      .from('users')
      .select('is_memories')
      .eq('id', userId)
      .maybeSingle();

    if (user?.is_memories) {
      return data({ error: 'Something went wrong. Please try again.' }, { status: 400 });
    }

    // No record (incl. the enumeration-safe sentinel id) → generic expired.
    const record = await getVerificationRecord(userId);
    if (!record) {
      return data({ error: 'Your code has expired. Please request a new one.' }, { status: 400 });
    }

    if (isVerificationCodeExpired(record.expires_at)) {
      await deleteVerificationRecord(userId);
      return data({ error: 'Your code has expired. Please request a new one.' }, { status: 400 });
    }

    // Hard per-code attempt cap. Burns the code after MAX_CODE_ATTEMPTS wrong
    // guesses, killing targeted brute-force regardless of rate-limit timing.
    if (typeof record.attempts === 'number' && record.attempts >= MAX_CODE_ATTEMPTS) {
      await deleteVerificationRecord(userId);
      return data({ error: 'Too many incorrect attempts. Please request a new code.' }, { status: 429 });
    }

    const isValid = await verifyCode(code, record.code_hash);

    await constantTimeDelay(50);

    if (!isValid) {
      const attempts = await incrementVerificationAttempts(userId);
      if (attempts !== null && attempts >= MAX_CODE_ATTEMPTS) {
        await deleteVerificationRecord(userId);
        return data({ error: 'Too many incorrect attempts. Please request a new code.' }, { status: 429 });
      }
      return data({ error: 'That code doesn\'t look right. Please check and try again.' }, { status: 400 });
    }

    resetAuthRateLimit(request, 'verify', userId);
    await deleteVerificationRecord(userId);

    if (type === 'signup') {
      const { error } = await db
        .from('users')
        .update({ verified: true, unverified_expire: null })
        .eq('id', userId);

      if (error) {
        return data({ error: 'Something went wrong. Please try again.' }, { status: 500 });
      }

      const headers = new Headers();
      clearVerifyContextCookie(headers);
      return redirect('/auth/login?verified=true', { headers });
    }

    if (type === 'reset') {
      const resetToken = await generateResetToken(userId, request.headers);
      if (!resetToken) {
        return data({ error: 'Something went wrong. Please try again.' }, { status: 500 });
      }
      const headers = new Headers();
      clearVerifyContextCookie(headers);
      return redirect(`/auth/reset/confirm?token=${encodeURIComponent(resetToken)}`, { headers });
    }

    const headers = new Headers();
    clearVerifyContextCookie(headers);
    return redirect('/auth/login?verified=true', { headers });
  } catch (error) {
    console.error('Error in verify action:', error);
    return data({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
};

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: 'Verify your email | Memories',
    description: 'Verify your email address to complete your Memories account setup and start using your profile.',
    canonicalPath: '/auth/verify',
    noindex: true,
  });

const Verify = () => {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [code, setCode] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const resendFormRef = useRef<HTMLFormElement>(null);
  const isSubmitting = navigation.state === 'submitting';

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  const handleResend = () => {
    if (resendCooldown > 0) return;
    setResendCooldown(60);
    resendFormRef.current?.submit();
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setCode(value);
  };

  const maskedEmail = loaderData.email || "your email address";

  return (
    <div className="w-full">
      <Card className="border-0 bg-transparent shadow-none">
        <CardHeader className="pb-1 pt-7 sm:pt-8 px-5 sm:px-8">
          <div className="flex flex-col items-center gap-2">
            <MailCheck className="h-8 w-8 text-primary" />
            <div className="text-center">
              <h1 className="text-xl font-semibold text-foreground">Check your email</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                We sent a 6-digit code to <span className="font-medium text-foreground">{maskedEmail}</span>
              </p>
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
            {actionData && 'message' in actionData && (
              <div className="flex items-start gap-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3.5 py-3 text-sm text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{actionData.message}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="code" className="text-sm font-medium text-foreground block text-center">
                Verification code
              </label>
              <Input
                id="code"
                name="code"
                type="text"
                inputMode="numeric"
                required
                value={code}
                onChange={handleCodeChange}
                placeholder="000000"
                maxLength={6}
                className="w-full text-center text-2xl tracking-[0.4em] font-mono h-14"
                autoComplete="one-time-code"
                autoFocus
              />
            </div>

            <Button type="submit" className="w-full h-11 font-medium" disabled={isSubmitting || code.length !== 6}>
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Verifying...
                </span>
              ) : (
                'Verify'
              )}
            </Button>

            <div className="text-center text-sm">
              <button
                type="button"
                onClick={handleResend}
                disabled={resendCooldown > 0 || isSubmitting}
                className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
              </button>
            </div>
          </form>

          <form ref={resendFormRef} method="post" className="hidden">
            <input type="hidden" name="actionType" value="resend" />
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

export default Verify;
