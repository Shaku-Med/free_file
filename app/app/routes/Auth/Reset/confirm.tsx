import { useState } from 'react';
import { data, redirect, useActionData, useLoaderData, useNavigation, Link } from 'react-router';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { CreatePassword } from '~/lib/Security/Password';
import db from '~/lib/Database/supabase';
import { isAuthenticated } from '~/lib/Security/Password';
import { sendPasswordResetNotification } from '../fun/email';

export const loader = async ({ request }: { request: Request }) => {
  const is_auth = await isAuthenticated(request);
  if (is_auth) {
    return redirect('/');
  }

  const url = new URL(request.url);
  const userId = url.searchParams.get('userId');
  const email = url.searchParams.get('email');

  if (!userId || !email) {
    return redirect('/auth/reset');
  }

  return data({ userId, email });
};

export const action = async ({ request }: { request: Request }) => {
  try {
    const formData = await request.formData();
    const password = formData.get('password') as string;
    const confirmPassword = formData.get('confirmPassword') as string;
    const userId = formData.get('userId') as string;

    if (!password || !confirmPassword) {
      return data({ error: 'All fields are required' }, { status: 400 });
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

    if (password.length < 8) {
      return data({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    if (password !== confirmPassword) {
      return data({ error: 'Passwords do not match' }, { status: 400 });
    }

    if (!db) {
      return data({ error: 'Database not initialized' }, { status: 500 });
    }

    const passwordHash = await CreatePassword(password);
    if (!passwordHash) {
      return data({ error: 'Failed to hash password' }, { status: 500 });
    }

    const { error } = await db
      .from('passwords')
      .upsert({
        id: userId,
        password: passwordHash,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'id'
      });

    if (error) {
      console.error('Error updating password:', error);
      return data({ error: 'Failed to update password' }, { status: 500 });
    }

    const { data: userData } = await db
      .from('users')
      .select('email')
      .eq('id', userId)
      .maybeSingle();

    if (userData?.email) {
      await sendPasswordResetNotification(userData.email, request);
    }

    return redirect('/auth/login?passwordReset=true');
  } catch (error) {
    console.error('Error in reset confirm action:', error);
    return data({ error: 'An unexpected error occurred' }, { status: 500 });
  }
};

const ResetConfirm = () => {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">Set new password</CardTitle>
          <CardDescription className="text-center">
            Enter your new password for {loaderData.email}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form method="post" className="space-y-4">
            <input type="hidden" name="userId" value={loaderData.userId} />

            {actionData?.error && (
              <div className="p-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md">
                {actionData.error}
              </div>
            )}
            
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                New Password
              </label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="••••••••"
                  autoComplete="new-password"
                  minLength={8}
                  className="w-full pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-sm"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="confirmPassword" className="text-sm font-medium">
                Confirm Password
              </label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  placeholder="••••••••"
                  autoComplete="new-password"
                  minLength={8}
                  className="w-full pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-sm"
                >
                  {showConfirmPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Updating password...' : 'Update password'}
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

export default ResetConfirm;

