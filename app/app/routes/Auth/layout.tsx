import { data, Outlet, redirect } from 'react-router'
import { isAuthenticated } from '~/lib/Security/Password';
import { useLoaderData } from 'react-router';
import { getAllKeys } from '~/lib/Security/unsharedkeyEncryption/Combined/Verification/TokenKeys';
import SetToken from '~/lib/Security/unsharedkeyEncryption/Combined/Verification/SetToken';
import Logo from '~/components/Navbar/Logo/Logo';
import { AuthGridFlow } from '~/components/AuthGridFlow';
import { ShieldAlert, Image, Video } from 'lucide-react';

export const loader = async ({ request }: { request: Request }) => {
  const is_auth = await isAuthenticated(request);
  const url = new URL(request.url);
  const addAccount = url.searchParams.get('addAccount') === '1';
  const isLoginRoute = url.pathname.endsWith('/login');
  if (is_auth && !addAccount) {
    const searchParams = url.searchParams.toString();
    const redirectUrl = searchParams ? `/?${searchParams}` : '/';
    return redirect(redirectUrl);
  }
  if (is_auth && addAccount && !isLoginRoute) {
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

  const features = [
    { icon: Image, label: 'Photos' },
    { icon: Video, label: 'Videos' },
  ];

  return (
    <div className="relative min-h-[100dvh] flex flex-col lg:flex-row overflow-hidden">
      <AuthGridFlow />

      <aside className="relative z-10 hidden lg:flex lg:w-[46%] xl:w-1/2 flex-col justify-between p-12 xl:p-20">
        <div className="flex items-center gap-3">
          <Logo className="h-9 w-9 text-primary ml-[-10px]" />
          <span className="text-xl font-semibold tracking-tight text-foreground">Memories</span>
        </div>

        <div className="max-w-md">
          <h1 className="text-4xl xl:text-5xl font-bold leading-[1.1] tracking-tight text-foreground">
            Your moments, kept close.
          </h1>
          <p className="mt-5 text-base leading-relaxed text-muted-foreground">
            Upload your photos and videos, share what you love, and come back to them whenever you want.
          </p>

          <div className="mt-10 flex flex-wrap gap-3">
            {features.map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-2.5 rounded-full border border-border/60 bg-card/40 px-4 py-2 backdrop-blur-sm"
              >
                <Icon className="h-4 w-4 shrink-0 text-primary" />
                <span className="text-sm font-medium text-foreground">{label}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-sm text-muted-foreground/70">
          © {new Date().getFullYear()} Memories
        </p>
      </aside>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-5 py-10 sm:px-8">
        <div className="lg:hidden mb-8 flex items-center gap-2.5">
          <Logo className="h-8 w-8 text-primary ml-[-10px]" />
          <span className="text-lg font-semibold tracking-tight text-foreground">Memories</span>
        </div>
        <div className="w-full max-w-[400px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default layout
