import { useState } from 'react';
import { data, redirect, useActionData, useNavigation, Link } from 'react-router';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { isAuthenticated } from '~/lib/Security/Password';
import db from '~/lib/Database/supabase';
import { generateVerificationCode, hashVerificationCode, saveVerificationCode } from '../fun/verification';
import { sendVerificationEmail } from '../fun/email';

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
      return data({ error: 'Username or email is required' }, { status: 400 });
    }

    if (!db) {
      return data({ error: 'Database not initialized' }, { status: 500 });
    }

    const isEmail = identifier.includes('@');
    let user;

    if (isEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(identifier)) {
        return data({ error: 'Invalid email format' }, { status: 400 });
      }

      const { data: userData, error } = await db
        .from('users')
        .select('id, email, is_memories')
        .eq('email', identifier.toLowerCase())
        .maybeSingle();

      if (error || !userData) {
        return data({ success: true, message: 'If an account exists, a verification code has been sent.' });
      }
      user = userData;
    } else {
      const { data: allUsers, error: fetchError } = await db
        .from('users')
        .select('id, email, username, is_memories');

      if (fetchError || !allUsers) {
        return data({ success: true, message: 'If an account exists, a verification code has been sent.' });
      }

      const foundUser = allUsers.find((u: { username: string }) => u.username.toLowerCase() === identifier.toLowerCase());
      if (!foundUser) {
        return data({ success: true, message: 'If an account exists, a verification code has been sent.' });
      }
      user = foundUser;
    }

    if (user.is_memories) {
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

    return redirect(`/auth/verify?userId=${user.id}&email=${encodeURIComponent(user.email)}&type=reset`);
  } catch (error) {
    console.error('Error in reset action:', error);
    return data({ error: 'An unexpected error occurred' }, { status: 500 });
  }
};

const Reset = () => {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">Reset password</CardTitle>
          <CardDescription className="text-center">
            Enter your username or email and we'll send you a verification code
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form method="post" className="space-y-4">
            {actionData && 'error' in actionData && (
              <div className="p-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md">
                {actionData.error}
              </div>
            )}

            
            <div className="space-y-2">
              <label htmlFor="identifier" className="text-sm font-medium">
                Username or Email
              </label>
              <Input
                id="identifier"
                name="identifier"
                type="text"
                required
                placeholder="username or email@example.com"
                autoComplete="username"
                className="w-full"
              />
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Sending...' : 'Send verification code'}
            </Button>
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

export default Reset;

