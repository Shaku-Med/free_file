import React from 'react'
import { data, Outlet, redirect } from 'react-router'
import { isAuthenticated } from '~/lib/Security/Password';
import { useLoaderData } from 'react-router';
import { getAllKeys } from '~/lib/Security/unsharedkeyEncryption/Combined/Verification/TokenKeys';
import SetToken from '~/lib/Security/unsharedkeyEncryption/Combined/Verification/SetToken';

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
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-foreground">Authentication unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">Please try again later.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-2">
      <aside className="hidden md:flex flex-col justify-center px-10 lg:px-16 py-12 border-r border-border/80">
        <div className="max-w-[280px]">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Memories</h1>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            A place where anything that enters never leaves.
          </p>
        </div>
      </aside>
      <main className="flex flex-col justify-center items-center w-full min-h-screen py-10 px-4 md:px-8 lg:px-12">
        <div className="w-full max-w-[380px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default layout