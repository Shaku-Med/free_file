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
  
  if(data?.error) {
    return (
      <div className="flex items-center justify-center min-h-screen py-6 px-4">
        <div className="text-center space-y-4 max-w-md">
          <h1 className="text-2xl font-bold">Authentication is unavailable at the moment</h1>
          <p className="text-muted-foreground">Please try again later.</p>
        </div>
      </div>
    );
  }
  
  return (
    <Outlet />
  )
}

export default layout