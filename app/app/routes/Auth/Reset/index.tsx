import { useState } from 'react';
import { data, redirect, useActionData, useNavigation, Link, type MetaFunction } from 'react-router';
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

    if (!identifier) {
      await constantTimeDelay();
      return data({ success: true, message: 'If an account exists, a verification code has been sent.' });
    }

    // Sanitize and normalize
    const sanitized = sanitizeString(identifier, 320);
    const normalized = normalizeIdentifier(sanitized);

    if (normalized.length < 3) {
      await constantTimeDelay();
      return data({ success: true, message: 'If an account exists, a verification code has been sent.' });
    }

    // Check rate limit
    const rateLimitCheck = checkAuthRateLimit(request, 'reset', normalized);
    if (!rateLimitCheck.allowed) {
      return data({ error: rateLimitCheck.error || 'Too many reset attempts. Please try again later.' }, { status: 429 });
    }

    if (!db) {
      await constantTimeDelay();
      return data({ success: true, message: 'If an account exists, a verification code has been sent.' });
    }

    const isEmail = normalized.includes('@');
    let user = null;

    // Prevent account enumeration - always return same message
    if (isEmail) {
      if (!isValidEmail(normalized)) {
        await constantTimeDelay();
        return data({ success: true, message: 'If an account exists, a verification code has been sent.' });
      }

      const { data: userData, error } = await db
        .from('users')
        .select('id, email, is_memories')
        .eq('email', normalized)
        .maybeSingle();

      if (!error && userData && !userData.is_memories) {
        user = userData;
      }
    } else {
      // Use efficient database query instead of fetching all users
      const { data: userData, error } = await db
        .from('users')
        .select('id, email, is_memories')
        .eq('username', normalized)
        .maybeSingle();

      if (!error && userData && !userData.is_memories) {
        user = userData;
      }
    }

    // Always return same message to prevent account enumeration
    if (!user) {
      await constantTimeDelay();
      return data({ success: true, message: 'If an account exists, a verification code has been sent.' });
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

export const meta: MetaFunction = () => {
  return [
    { title: 'Reset Password | Memories' },
    { name: 'description', content: 'Reset your Memories account password to regain access to your account.' },
  ];
};

const Reset = () => {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-lg border-2 animate-in fade-in-0 zoom-in-95 duration-300">
        <CardHeader className="space-y-2 pb-6">
          <CardTitle className="text-3xl font-bold text-center bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            Reset Password
          </CardTitle>
          <CardDescription className="text-center text-base">
            Enter your username or email to receive a verification code
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <form method="post" className="space-y-5">
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
              <label htmlFor="identifier" className="text-sm font-semibold text-foreground">
                Username or Email
              </label>
              <Input
                id="identifier"
                name="identifier"
                type="text"
                required
                placeholder="Enter your username or email"
                autoComplete="username"
                className="w-full h-11 transition-all focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <Button 
              type="submit" 
              className="w-full h-11 text-base font-semibold shadow-md hover:shadow-lg transition-all" 
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Sending code...' : 'Send Verification Code'}
            </Button>
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

export default Reset;

