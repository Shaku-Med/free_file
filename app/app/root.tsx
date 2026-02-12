import {
  data,
  Links,
  Meta,
  Outlet,
  Scripts,
  useLoaderData,
  type MetaFunction,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ContextProvider } from "./lib/Context/Context";
import { LikeProvider } from "./lib/Context/LikeContext";
import { PictureInPictureProvider } from "./lib/Context/PictureInPictureContext";
import db from "./lib/Database/supabase";
import ErrorMessage from "./components/ErrorMessage";
import { getCookie } from "./lib/Security/Token";
import { VerifyToken } from "./lib/Security/unsharedkeyEncryption/Combined/Verification/VerifyToken";
import SetToken from "./lib/Security/unsharedkeyEncryption/Combined/Verification/SetToken";
import { isAuthenticated } from "./lib/Security/Password";
import NavProgress from "./routes/Home/NavProgress/NavProgress";
import { SidebarProvider, SidebarInset } from "./components/ui/sidebar";
import { AppSidebar } from "./components/Navbar/components/Sidebar";
import BodyComponent from "./components/Navbar/components/BodyComponent";
import RegisterServiceWorker from "./components/RegisterServiceWorker";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
]

const VerifyB4Making = async (headers: Headers, keys: string[]) => {
  let token = getCookie('token', headers)
  if(!token) return null
  let decoded = await VerifyToken({
    token: token,
    addedKeyNames: keys || []
  }, headers)
  if(!decoded) return null
  return true;
}

const userMiddleware: Route.MiddlewareFunction = async ({ context }, next) => {
  let response = await next()
  response.headers.set("Cross-Origin-Embedder-Policy", "require-corp")
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin")
  response.headers.set("Content-Security-Policy", "frame-ancestors 'none'")
  response.headers.set("X-Frame-Options", "DENY")
  // 
  return response
};

export const middleware = [userMiddleware] satisfies Route.MiddlewareFunction[]

let verifySessionToken = async (headers: Headers) => {
  try {
    let keys = ['session_id']
    let token = getCookie('sessionId', headers)
    if(!token) return null
    let decoded = await VerifyToken({
      token: token,
      addedKeyNames: keys || []
    }, headers)
    if(!decoded) return null
    if(!token) return null
    return true
  }
  catch (error) {
    console.error('Error in verifySessionToken: ', error)
    return null
  }
}

let makeSessionToken = async (headers: Headers) => {
  try {
    let verified = await verifySessionToken(headers)
    if(verified) return 'not_needed'
    let keys = ['file_token']
    let token = await SetToken(headers, {
      expiresIn: '10m',
      algorithm: 'HS512'
    }, keys)
    if(!token) return null
    return token.data
  }
  catch (error) {
    console.error('Error in makeSessionToken: ', error)
    return null
  }
}

export const loader = async ({request}: {request: Request}) => {
  try {
    let sessionToken = await makeSessionToken(request.headers)
    if(!sessionToken) return data(null, { status: 500 });
    
    if(!db) return data(null, { status: 500 })
    let keys = ['token1', 'token2']
    let verified = await VerifyB4Making(request.headers, keys)

    const user = await isAuthenticated(request, ['id']);
    const userId = user?.id || null;

    let token: string | null = null
    if(!verified){
      let t = await SetToken(request.headers, {
        expiresIn: '1d',
        algorithm: 'HS512'
      }, keys)
      if(!t) return data(null, { status: 500 });
      token = t?.data
    }

    const sameSite = process.env.NODE_ENV === 'production' ? 'SameSite=None' : 'SameSite=Lax';
    const secure = process.env.NODE_ENV === 'production' ? 'Secure' : '';

    let c_user = getCookie('c_user', request.headers);

    const uploadServerUrl =
      typeof process !== 'undefined' && process.env?.UPLOAD_SERVER_URL
        ? process.env.UPLOAD_SERVER_URL
        : (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development'
          ? 'http://localhost:3003'
          : '');

    return data({ st: sessionToken, user_agent: request.headers.get('user-agent'), userId, c_user, uploadServerUrl }, {
      status: 200,
      headers: (token && !user) ? {
        'Set-Cookie': `token=${token}; Path=/; HttpOnly; Max-Age=86400; ${secure}; ${sameSite}`
      } : undefined
    } as ResponseInit);
  }
  catch (error) {
    console.error('Error in loader:', error)
    return data(null, { status: 500 });
  }
}

export const meta: MetaFunction<ReturnType<typeof loader>> = ({ data }) => {
  try {
    if(!data) {
      return [
        {
          title: 'Error',
          description: 'Error loading data',
        },
      ]
    }
    return [
      {
        title: 'Memories',
        description: `A place where anything that enters never leaves.`,
      },
    ]
  }
  catch (error) {
    // console.error('Error in meta:', error);
    return [
      {
        title: 'Error',
        description: 'Error loading data',
      },
    ]
  }
}

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useLoaderData<typeof loader>();
  if (!data) {
    return (
       <html className="system">
        <head>
          <title>Error</title>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
          <meta name="mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-title" content="Memories" />
          <meta name="mobile-web-app-title" content="Memories" />
          <meta name="description" content="Memories is a photo gallery app that allows you to view and share your photos." />
          <meta name="keywords" content="photo, gallery, app, share, view" />
          <link rel="shortcut icon" href="/favicon.ico" />
          <link rel="apple-touch-icon" href="/icons/web/apple-touch-icon.png" />
          <Meta />
          <Links />
        </head>
        <body>
          <ErrorMessage message={{
            title: 'Error',
            description: `Something went wrong!`,
            action: `window.location.reload()`,
            actionText: 'Refresh Page',
          }}/>
        </body>
      </html>
    )
  }

  const { st, user_agent, userId, c_user, uploadServerUrl } = data;

  return (
    <html className={`system overflow-hidden h-full w-full fixed top-0 left-0`} lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Memories" />
        <meta name="mobile-web-app-title" content="Memories" />
        <meta name="description" content="Memories is a photo gallery app that allows you to view and share your photos." />
        <meta name="keywords" content="photo, gallery, app, share, view" />
        <link rel="shortcut icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/icons/web/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.json" />
        <Meta />
        <Links />
      </head>
      <body className={`flex flex-col fixed top-0 left-0 w-full h-full`}>
        <RegisterServiceWorker />
        <ErrorBoundary>
          <ContextProvider st={st} user_agent={user_agent || ''} userId={userId || null} c_user={c_user || null} uploadServerUrl={uploadServerUrl || ''}>
            <LikeProvider>
              <PictureInPictureProvider>
                <SidebarProvider className={`w-full h-full flex-1 min-h-0`}>
                  <AppSidebar />
                  <SidebarInset className={`w-full h-full`}>
                      <BodyComponent>
                          {children}
                      </BodyComponent>
                    <NavProgress/>
                  </SidebarInset>
                </SidebarProvider>
              </PictureInPictureProvider>
            </LikeProvider>
          </ContextProvider>
        </ErrorBoundary>
        <Scripts />

        <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>

      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
