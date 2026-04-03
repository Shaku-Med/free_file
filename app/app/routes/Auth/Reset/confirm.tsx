import { useState } from 'react';
import { data, redirect, useActionData, useLoaderData, useNavigation, Link } from 'react-router';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Card, CardContent, CardHeader } from '~/components/ui/card';
import { CreatePassword } from '~/lib/Security/Password';
import db from '~/lib/Database/supabase';
import { isAuthenticated } from '~/lib/Security/Password';
import { sendPasswordResetNotification } from '../fun/email';
import { validatePasswordStrength, constantTimeDelay } from '../fun/validation';
import { validateResetToken, markResetTokenAsUsed } from '../fun/verification';
import crypto from 'crypto';
import { ShieldCheck, Eye, EyeOff, AlertCircle, Lock, ArrowLeft } from 'lucide-react';

export const loader = async ({ request }: { request: Request }) => {
  const is_auth = await isAuthenticated(request);
  if (is_auth) {
    return redirect('/');
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return redirect('/auth/reset');
  }

  const tokenData = await validateResetToken(token, request.headers);
  if (!tokenData) {
    return redirect('/auth/reset');
  }

  return data({ userId: tokenData.userId, email: tokenData.email, token });
};

export const action = async ({ request }: { request: Request }) => {
  try {
    const formData = await request.formData();
    const password = formData.get('password') as string;
    const confirmPassword = formData.get('confirmPassword') as string;
    const token = formData.get('token') as string;

    if (!password || !confirmPassword || !token) {
      return data({ error: 'Please fill in all fields.' }, { status: 400 });
    }

    const tokenData = await validateResetToken(token, request.headers);
    if (!tokenData) {
      await constantTimeDelay();
      return data({ error: 'This link has expired. Please request a new password reset.' }, { status: 400 });
    }

    if (!db) {
      return data({ error: 'Something went wrong. Please try again.' }, { status: 500 });
    }

    const { data: user, error: userError } = await db
      .from('users')
      .select('is_memories')
      .eq('id', tokenData.userId)
      .maybeSingle();

    if (userError || !user) {
      return data({ error: 'Something went wrong. Please try again.' }, { status: 400 });
    }

    if (user.is_memories) {
      return data({ error: 'Something went wrong. Please try again.' }, { status: 400 });
    }

    const passwordValidation = validatePasswordStrength(password);
    if (!passwordValidation.valid) {
      return data({ error: 'Please choose a stronger password.' }, { status: 400 });
    }

    if (password !== confirmPassword) {
      await constantTimeDelay();
      return data({ error: 'Passwords don\'t match. Please try again.' }, { status: 400 });
    }

    if (!db) {
      return data({ error: 'Something went wrong. Please try again.' }, { status: 500 });
    }

    const passwordHash = await CreatePassword(password);
    if (!passwordHash) {
      return data({ error: 'Something went wrong. Please try again.' }, { status: 500 });
    }

    const { error } = await db
      .from('passwords')
      .upsert({
        id: tokenData.userId,
        password: passwordHash,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'id'
      });

    if (error) {
      console.error('Error updating password:', error);
      return data({ error: 'Something went wrong. Please try again.' }, { status: 500 });
    }

    const newC_usr = crypto.randomUUID();
    const { error: cUserError } = await db
      .from('users')
      .update({ c_usr: newC_usr })
      .eq('id', tokenData.userId);

    if (cUserError) {
      console.error('Error updating c_usr:', cUserError);
      return data({ error: 'Something went wrong. Please try again.' }, { status: 500 });
    }

    const { data: userData } = await db
      .from('users')
      .select('email')
      .eq('id', tokenData.userId)
      .maybeSingle();

    await markResetTokenAsUsed(tokenData.userId);

    if (userData?.email) {
      await sendPasswordResetNotification(userData.email, request);
    }

    return redirect('/auth/login?passwordReset=true');
  } catch (error) {
    console.error('Error in reset confirm action:', error);
    return data({ error: 'Something went wrong. Please try again.' }, { status: 500 });
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
    <div className="w-full">
      <Card className="border border-border/60 shadow-sm">
        <CardHeader className="pb-1 pt-7 sm:pt-8 px-5 sm:px-8">
          <div className="flex flex-col items-center gap-2">
            <ShieldCheck className="h-8 w-8 text-primary" />
            <div className="text-center">
              <h1 className="text-xl font-semibold text-foreground">Set new password</h1>
              <p className="mt-1 text-sm text-muted-foreground">Choose a strong password for your account</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-5 sm:px-8 pb-6 sm:pb-8 pt-4">
          <form method="post" className="space-y-3.5">
            <input type="hidden" name="token" value={loaderData.token} />

            {actionData?.error && (
              <div className="flex items-start gap-2.5 rounded-lg bg-destructive/10 border border-destructive/20 px-3.5 py-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{actionData.error}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium text-foreground">
                New password
              </label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="Enter new password"
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

            <div className="space-y-1.5">
              <label htmlFor="confirmPassword" className="text-sm font-medium text-foreground">
                Confirm password
              </label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  placeholder="Confirm new password"
                  autoComplete="new-password"
                  minLength={8}
                  className="w-full h-11 pl-10 pr-10"
                />
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground transition-colors"
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" className="w-full h-11 font-medium" disabled={isSubmitting}>
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Updating password...
                </span>
              ) : (
                'Update password'
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

export default ResetConfirm;
