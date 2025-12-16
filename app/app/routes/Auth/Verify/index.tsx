import { useState, useEffect } from 'react';
import { data, redirect, useActionData, useLoaderData, useNavigation, useSearchParams, Link } from 'react-router';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { getVerificationRecord, verifyCode, isVerificationCodeExpired, deleteVerificationRecord } from '../fun/verification';
import { resendVerificationCode } from '../fun/auth';
import db from '~/lib/Database/supabase';
import { isAuthenticated } from '~/lib/Security/Password';

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
      const result = await resendVerificationCode(userId, email, type as 'signup' | 'reset' | 'verify');
      if (!result.success) {
        return data({ error: result.error || 'Failed to resend code' }, { status: 400 });
      }
      return data({ success: true, message: 'Verification code resent successfully' });
    }

    if (!code || code.length !== 6) {
      return data({ error: 'Please enter a valid 6-digit code' }, { status: 400 });
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
    if (!isValid) {
      return data({ error: 'Invalid verification code' }, { status: 400 });
    }

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
      return redirect(`/auth/reset/confirm?userId=${userId}&email=${encodeURIComponent(email)}`);
    }

    return redirect('/auth/login?verified=true');
  } catch (error) {
    console.error('Error in verify action:', error);
    return data({ error: 'An unexpected error occurred' }, { status: 500 });
  }
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
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">Verify your email</CardTitle>
          <CardDescription className="text-center">
            We've sent a 6-digit verification code to {loaderData.email}
          </CardDescription>
        </CardHeader>
        <CardContent>
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
              <div className="p-3 text-sm text-green-600 bg-green-50 border border-green-200 rounded-md dark:bg-green-900/20 dark:border-green-800 dark:text-green-400">
                {actionData.message}
              </div>
            )}
            
            <div className="space-y-2">
              <label htmlFor="code" className="text-sm font-medium">
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
                className="w-full text-center text-2xl tracking-widest font-mono"
                autoComplete="one-time-code"
              />
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting || code.length !== 6}>
              {isSubmitting ? 'Verifying...' : 'Verify'}
            </Button>

            <div className="text-center space-y-2">
              <p className="text-sm text-muted-foreground">
                Didn't receive the code?
              </p>
              <button
                type="button"
                onClick={handleResend}
                disabled={resendCooldown > 0}
                className="text-sm text-primary hover:underline disabled:text-muted-foreground disabled:cursor-not-allowed"
              >
                {resendCooldown > 0 
                  ? `Resend code in ${resendCooldown}s` 
                  : 'Resend verification code'}
              </button>
            </div>
          </form>

          <div className="mt-4 text-center text-sm">
            <Link to="/auth/login" className="text-primary hover:underline">
              Back to login
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Verify;
