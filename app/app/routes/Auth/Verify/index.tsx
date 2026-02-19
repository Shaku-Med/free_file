import { useState, useEffect } from 'react';
import { data, redirect, useActionData, useLoaderData, useNavigation, useSearchParams, Link, type MetaFunction } from 'react-router';
import { buildPageMeta } from '~/lib/seo';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { getVerificationRecord, verifyCode, isVerificationCodeExpired, deleteVerificationRecord, generateResetToken } from '../fun/verification';
import { resendVerificationCode } from '../fun/auth';
import db from '~/lib/Database/supabase';
import { isAuthenticated } from '~/lib/Security/Password';
import { checkAuthRateLimit, resetAuthRateLimit } from '../fun/rateLimit';
import { isValidVerificationCode, constantTimeDelay } from '../fun/validation';

export const loader = async ({ request }: { request: Request }) => {
  const is_auth = await isAuthenticated(request);
  if (is_auth) {
    return redirect('/');
  }

  const url = new URL(request.url);
  const userId = url.searchParams.get('userId');
  const type = url.searchParams.get('type') || 'verify';

  if (!userId) {
    return redirect('/auth/login');
  }

  if (!db) {
    return redirect('/auth/login');
  }

  // Get email from database using userId - never trust email from URL
  const { data: user, error: userError } = await db
    .from('users')
    .select('email, is_memories')
    .eq('id', userId)
    .maybeSingle();

  if (userError || !user || user.is_memories) {
    return redirect('/auth/login');
  }

  return data({ userId, email: user.email, type });
};

export const action = async ({ request }: { request: Request }) => {
  try {
    const formData = await request.formData();
    const code = formData.get('code') as string;
    const userId = formData.get('userId') as string;
    const type = formData.get('type') as string;
    const actionType = formData.get('actionType') as string;

    if (actionType === 'resend') {
      // Check rate limit for resend
      const rateLimitCheck = checkAuthRateLimit(request, 'resend', userId);
      if (!rateLimitCheck.allowed) {
        return data({ error: rateLimitCheck.error || 'Too many resend attempts. Please try again later.' }, { status: 429 });
      }

      // resendVerificationCode now gets email from database using userId
      const result = await resendVerificationCode(userId, type as 'signup' | 'reset' | 'verify');
      if (!result.success) {
        return data({ error: result.error || 'Failed to resend code' }, { status: 400 });
      }

      // Reset rate limit on successful resend
      resetAuthRateLimit(request, 'resend', userId);
      return data({ success: true, message: 'Verification code resent successfully' });
    }

    // Validate verification code format
    if (!code || !isValidVerificationCode(code)) {
      await constantTimeDelay();
      return data({ error: 'Please enter a valid 6-digit code' }, { status: 400 });
    }

    // Check rate limit for verification attempts
    const rateLimitCheck = checkAuthRateLimit(request, 'verify', userId);
    if (!rateLimitCheck.allowed) {
      return data({ error: rateLimitCheck.error || 'Too many verification attempts. Please try again later.' }, { status: 429 });
    }

    if (!db) {
      return data({ error: 'Database not initialized' }, { status: 500 });
    }

    const { data: user, error: userError } = await db
      .from('users')
      .select('is_memories')
      .eq('id', userId)
      .maybeSingle();

    if (userError || !user) {
      return data({ error: 'Invalid username/email or password' }, { status: 400 });
    }

    if (user.is_memories) {
      return data({ error: 'Invalid username/email or password' }, { status: 400 });
    }

    const record = await getVerificationRecord(userId);
    if (!record) {
      return data({ error: 'Verification code not found. Please request a new one.' }, { status: 400 });
    }

    if (isVerificationCodeExpired(record.expires_at)) {
      return data({ error: 'Verification code has expired. Please request a new one.' }, { status: 400 });
    }

    const isValid = await verifyCode(code, record.code_hash);
    
    // Add constant delay to prevent timing attacks
    await constantTimeDelay(50);
    
    if (!isValid) {
      return data({ error: 'Invalid verification code' }, { status: 400 });
    }

    // Reset rate limit on successful verification
    resetAuthRateLimit(request, 'verify', userId);
    await deleteVerificationRecord(userId);

    if (type === 'signup') {
      if (!db) {
        return data({ error: 'Database not initialized' }, { status: 500 });
      }
      const { error } = await db
        .from('users')
        .update({ verified: true, unverified_expire: null })
        .eq('id', userId);
      
      if (error) {
        return data({ error: 'Failed to verify account' }, { status: 500 });
      }
      
      return redirect('/auth/login?verified=true');
    }

    if (type === 'reset') {
      // generateResetToken now gets email from database using userId
      const resetToken = await generateResetToken(userId, request.headers);
      if (!resetToken) {
        return data({ error: 'An error occurred. Please try again later.' }, { status: 500 });
      }
      return redirect(`/auth/reset/confirm?token=${encodeURIComponent(resetToken)}`);
    }

    return redirect('/auth/login?verified=true');
  } catch (error) {
    console.error('Error in verify action:', error);
    return data({ error: 'An unexpected error occurred' }, { status: 500 });
  }
};

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: 'Verify Email | Memories',
    description: 'Verify your email address to complete your Memories account setup.',
    canonicalPath: '/auth/verify',
    noindex: true,
  });

const Verify = () => {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [code, setCode] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
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
    const form = document.createElement('form');
    form.method = 'post';
    form.innerHTML = `
      <input type="hidden" name="actionType" value="resend" />
      <input type="hidden" name="userId" value="${loaderData.userId}" />
      <input type="hidden" name="type" value="${loaderData.type}" />
    `;
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setCode(value);
  };

  return (
    <div className="w-full max-w-md">
      <Card className="border shadow-sm">
        <CardHeader className="space-y-1 pb-4">
          <CardTitle className="text-2xl font-semibold text-center text-foreground">
            Verify your email
          </CardTitle>
          <CardDescription className="text-center text-muted-foreground">
            We sent a 6-digit code to <span className="font-medium text-foreground">{loaderData.email}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form method="post" className="space-y-4">
            <input type="hidden" name="userId" value={loaderData.userId} />
            <input type="hidden" name="email" value={loaderData.email} />
            <input type="hidden" name="type" value={loaderData.type} />

            {actionData && 'error' in actionData && (
              <div className="p-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md">
                {actionData.error}
              </div>
            )}
            {actionData && 'message' in actionData && (
              <div className="p-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md dark:text-green-300 dark:bg-green-900/20 dark:border-green-800">
                {actionData.message}
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="code" className="text-sm font-medium text-foreground block text-center">
                Verification code
              </label>
              <Input
                id="code"
                name="code"
                type="text"
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

            <Button type="submit" className="w-full" disabled={isSubmitting || code.length !== 6}>
              {isSubmitting ? 'Verifying...' : 'Verify'}
            </Button>

            <div className="text-center text-sm">
              <button
                type="button"
                onClick={handleResend}
                disabled={resendCooldown > 0 || isSubmitting}
                className="text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline"
              >
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
              </button>
            </div>
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

export default Verify;
