import { useState, useEffect } from 'react';
import { data, redirect, useActionData, useLoaderData, useNavigation, useSearchParams, Link, type MetaFunction } from 'react-router';
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
  const email = url.searchParams.get('email');
  const type = url.searchParams.get('type') || 'verify';

  if (!userId || !email) {
    return redirect('/auth/login');
  }

  return data({ userId, email, type });
};

export const action = async ({ request }: { request: Request }) => {
  try {
    const formData = await request.formData();
    const code = formData.get('code') as string;
    const userId = formData.get('userId') as string;
    const email = formData.get('email') as string;
    const type = formData.get('type') as string;
    const actionType = formData.get('actionType') as string;

    if (actionType === 'resend') {
      // Check rate limit for resend
      const rateLimitCheck = checkAuthRateLimit(request, 'resend', userId);
      if (!rateLimitCheck.allowed) {
        return data({ error: rateLimitCheck.error || 'Too many resend attempts. Please try again later.' }, { status: 429 });
      }

      const result = await resendVerificationCode(userId, email, type as 'signup' | 'reset' | 'verify');
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
      const resetToken = await generateResetToken(userId, email, request.headers);
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

export const meta: MetaFunction = () => {
  return [
    { title: 'Verify Email | Memories' },
    { name: 'description', content: 'Verify your email address to complete your Memories account setup.' }
  ];
};

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
      <input type="hidden" name="email" value="${loaderData.email}" />
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
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md shadow-lg border-2 animate-in fade-in-0 zoom-in-95 duration-300">
        <CardHeader className="space-y-2 pb-6">
          <CardTitle className="text-3xl font-bold text-center bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            Verify Your Email
          </CardTitle>
          <CardDescription className="text-center text-base">
            We've sent a 6-digit verification code to
            <br />
            <span className="font-semibold text-foreground">{loaderData.email}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <form method="post" className="space-y-5">
            <input type="hidden" name="userId" value={loaderData.userId} />
            <input type="hidden" name="email" value={loaderData.email} />
            <input type="hidden" name="type" value={loaderData.type} />

            {actionData && 'error' in actionData && (
              <div className="p-4 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg animate-in slide-in-from-top-2 duration-200">
                {actionData.error}
              </div>
            )}

            {actionData && 'message' in actionData && (
              <div className="p-4 text-sm text-green-600 bg-green-50 border border-green-200 rounded-lg dark:bg-green-900/20 dark:border-green-800 dark:text-green-400 animate-in slide-in-from-top-2 duration-200">
                {actionData.message}
              </div>
            )}
            
            <div className="space-y-2.5">
              <label htmlFor="code" className="text-sm font-semibold text-foreground text-center block">
                Verification Code
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
                className="w-full text-center text-3xl tracking-[0.5em] font-mono h-16 transition-all focus:ring-2 focus:ring-primary/20"
                autoComplete="one-time-code"
                autoFocus
              />
              <p className="text-xs text-muted-foreground text-center">
                Enter the 6-digit code sent to your email
              </p>
            </div>

            <Button 
              type="submit" 
              className="w-full h-11 text-base font-semibold shadow-md hover:shadow-lg transition-all" 
              disabled={isSubmitting || code.length !== 6}
            >
              {isSubmitting ? 'Verifying...' : 'Verify Email'}
            </Button>

            <div className="text-center space-y-3 pt-2">
              <p className="text-sm text-muted-foreground">
                Didn't receive the code?
              </p>
              <button
                type="button"
                onClick={handleResend}
                disabled={resendCooldown > 0 || isSubmitting}
                className="text-sm text-primary hover:text-primary/80 font-semibold transition-colors hover:underline disabled:text-muted-foreground disabled:cursor-not-allowed disabled:no-underline"
              >
                {resendCooldown > 0 
                  ? `Resend code in ${resendCooldown}s` 
                  : 'Resend Verification Code'}
              </button>
            </div>
          </form>

          <div className="mt-6 pt-6 border-t border-border text-center">
            <Link 
              to="/auth/login" 
              className="text-sm text-primary hover:text-primary/80 font-semibold transition-colors hover:underline"
            >
              Back to sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Verify;
