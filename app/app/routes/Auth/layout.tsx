import React from 'react'
import { data, Outlet, redirect } from 'react-router'
import { isAuthenticated } from '~/lib/Security/Password';
import { useLoaderData } from 'react-router';
import { getAllKeys } from '~/lib/Security/unsharedkeyEncryption/Combined/Verification/TokenKeys';
import SetToken from '~/lib/Security/unsharedkeyEncryption/Combined/Verification/SetToken';
import Logo from '~/components/Navbar/Logo/Logo';
import { ShieldAlert, ShieldCheck, Image, Video, Music, Upload } from 'lucide-react';

export const loader = async ({ request }: { request: Request }) => {
  const is_auth = await isAuthenticated(request);
  if(is_auth) {
    const url = new URL(request.url);
    const searchParams = url.searchParams.toString();
    const redirectUrl = searchParams ? `/?${searchParams}` : '/';
    return redirect(redirectUrl);
  }

  const keys = await getAllKeys(['temp_token']);
  if(!keys) {
    return data({ error: true }, { status: 500 });
  }

  const tempToken = await SetToken(request.headers, {
    expiresIn: '1h',
    algorithm: 'HS512'
  }, ['temp_token']);

  if(!tempToken) {
    return data({ error: true }, { status: 500 });
  }

  return data({ error: false }, { status: 200 });
}

const layout = () => {
  const data = useLoaderData<typeof loader>();

  if (data?.error) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-xl border bg-card p-8 text-center shadow-lg">
          <ShieldAlert className="h-8 w-8 text-destructive mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-foreground">We'll be right back</h1>
          <p className="mt-2 text-sm text-muted-foreground">Something's not working right now. Please try again in a moment.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] grid grid-cols-1 lg:grid-cols-[1fr_480px] xl:grid-cols-[1fr_520px]">
      <aside className="hidden lg:flex flex-col justify-between bg-card border-r border-border/60 overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/3" />

        <div className="relative z-10 flex flex-col justify-center flex-1 px-12 xl:px-20 py-12">
          <div className="max-w-[340px]">
            <div className="flex items-center gap-3 mb-8">
              <Logo className="w-9 h-9 text-primary" />
              <span className="text-xl font-semibold text-foreground tracking-tight">Memories</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground leading-tight">
              A place where anything that enters never leaves.
            </h1>
            <p className="mt-4 text-muted-foreground leading-relaxed">
              Upload, share, and relive your favorite moments. Your content, your space.
            </p>

            <div className="mt-10 grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-background/50 px-3.5 py-2.5">
                <Image className="h-4 w-4 text-primary shrink-0" />
                <span className="text-xs text-muted-foreground">Photos</span>
              </div>
              <div className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-background/50 px-3.5 py-2.5">
                <Video className="h-4 w-4 text-primary shrink-0" />
                <span className="text-xs text-muted-foreground">Videos</span>
              </div>
              <div className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-background/50 px-3.5 py-2.5">
                <Music className="h-4 w-4 text-primary shrink-0" />
                <span className="text-xs text-muted-foreground">Audio</span>
              </div>
              <div className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-background/50 px-3.5 py-2.5">
                <Upload className="h-4 w-4 text-primary shrink-0" />
                <span className="text-xs text-muted-foreground">Any file</span>
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-10 px-12 xl:px-20 pb-8">
          <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Protected with end-to-end encryption</span>
          </div>
        </div>

        <div className="absolute -bottom-16 -right-16 w-64 h-64 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-primary/3 blur-2xl" />
      </aside>
      <main className="flex flex-col justify-center items-center w-full min-h-[100dvh] py-6 px-5 sm:px-8">
        <div className="lg:hidden flex items-center gap-2.5 mb-6">
          <Logo className="w-8 h-8 text-primary" />
          <span className="text-lg font-semibold text-foreground tracking-tight">Memories</span>
        </div>
        <div className="w-full max-w-[400px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default layout
