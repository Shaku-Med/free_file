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
import { buildDefaultMeta, buildErrorMeta, SITE_NAME } from "./lib/seo";
import { ContextProvider } from "./lib/Context/Context";
import { LikeProvider } from "./lib/Context/LikeContext";
import { PictureInPictureProvider } from "./lib/Context/PictureInPictureContext";
import { MiniPlayerProvider } from "./lib/Context/MiniPlayerContext";
import { MainPlayerSlotProvider } from "./lib/Context/MainPlayerSlotContext";
import { WatchSurfaceVideoRefProvider } from "./lib/Context/WatchSurfaceVideoRefContext";
import { WatchPlayBootstrapProvider } from "./lib/Context/WatchPlayBootstrapContext";
import { WatchHlsSurfaceProvider } from "./lib/Context/WatchHlsSurfaceContext";
import { WatchProgressProvider } from "./lib/Context/WatchProgressContext";
import { RootPlayQueueProvider } from "./components/MainPlayer/RootPlayQueueProvider";
import { GlobalAnchoredHLSPlayer } from "./components/MainPlayer/GlobalAnchoredHLSPlayer";
import { GlobalPlayerLayoutProvider } from "./lib/Context/GlobalPlayerLayoutContext";
import MiniPlayer from "./components/MiniPlayer/MiniPlayer";
import { CloseMiniPlayerOnNavigateToVideo } from "./components/MiniPlayer/CloseMiniPlayerOnNavigateToVideo";
import db from "./lib/Database/supabase";
import ErrorMessage from "./components/ErrorMessage";
import { getCookie } from "./lib/Security/Token";
import { VerifyToken } from "./lib/Security/unsharedkeyEncryption/Combined/Verification/VerifyToken";
import SetToken from "./lib/Security/unsharedkeyEncryption/Combined/Verification/SetToken";
import { isAuthenticated } from "./lib/Security/Password";
import AppShell from "./components/AppShell";
import RegisterServiceWorker from "./components/RegisterServiceWorker";
import { ThemeApply } from "./components/ThemeApply";
import SignInPrompt from "./components/SignInPrompt";
import PushPromptOverlay from "./components/PushPromptOverlay";
import { Toaster } from "./components/ui/sonner";
import { ErrorDetailsDialog } from "./components/ErrorDetailsDialog";
import type { UserTheme } from "./lib/theme/constants";
import { parseUserTheme } from "./lib/theme/constants";
import { getPlayerSettingsFromCookies } from "./routes/Api/player-settings";
import { BASE_URL } from "./lib/URLS";
import { isMobileUserAgent } from "./lib/device.server";
import { readAltAccountsFromRequest } from "./lib/Security/accountVault";

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
  let response = await next();
  // COEP/COOP removed: they block extension-injected resources and cause
  // ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep.
  // Re-enable only if you need SharedArrayBuffer (e.g. require-corp + same-origin).
  // Same-origin pages may embed each other (e.g. /pip iframes the watch page). Block third-party embeds.
  response.headers.set("Content-Security-Policy", "frame-ancestors 'self'");
  // response.headers.set("X-Frame-Options", "DENY");
  return response;
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

const getRequestURL = (request: Request) => {
  try {
    const origin = new URL(request.url)?.origin;
    let newBaseURL = origin.toLowerCase() == BASE_URL.toLowerCase() ? BASE_URL : origin;
    return newBaseURL;
  }
  catch (error) {
    return null
  }
}

export const loader = async ({request}: {request: Request}) => {
  try {
    let requestURL = getRequestURL(request);
    if(!requestURL) return data(`Upstream error: ${request.url}`, { status: 400 });

    let sessionToken = await makeSessionToken(request.headers);

    if (!sessionToken) {
      console.warn("[root] makeSessionToken failed; serving page without session.");
      return data(null, { status: 400 });
    }

    if (!db) return data(null, { status: 500 });

    let keys = ['token1', 'token2'];
    let verified = await VerifyB4Making(request.headers, keys);

    const user = await isAuthenticated(request, ['id']);
    const userId = user?.id || null;

    let token: string | null = null;
    if (!verified) {
      let t = await SetToken(request.headers, {
        expiresIn: '1d',
        algorithm: 'HS512'
      }, keys);
      if (!t) {
        console.warn("[root] SetToken failed; continuing without auth cookie.");
      } else {
        token = t?.data;
      }
    }

    const sameSite = process.env.NODE_ENV === 'production' ? 'SameSite=None' : 'SameSite=Lax';
    const secure = process.env.NODE_ENV === 'production' ? 'Secure' : '';

    const uploadServerUrl =
      (typeof process !== 'undefined' &&
        (process.env?.UPLOAD_SERVER_URL || process.env?.GO_UPLOAD_URL)?.replace(/\/$/, '')) ||
      (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development' ? 'http://localhost:3003' : '');

    let userTheme: UserTheme | null = null;
    if (userId && db) {
      const { data: row } = await db.from("users").select("theme").eq("id", userId).single();
      const parsed = parseUserTheme(row?.theme ?? null);
      if (parsed) userTheme = parsed;
    }

    const playerSettingsFromLoader = getPlayerSettingsFromCookies(request.headers.get('Cookie'));
    const isMobileServer = isMobileUserAgent(request.headers.get('user-agent'));
    const isDevelopmentServer = process.env.NODE_ENV === 'development';

    const altVault = readAltAccountsFromRequest(request.headers);
    const altAccounts = altVault.map(({ id, u, pic }) => ({
      id,
      username: u,
      profile_pic: pic ?? null,
    }));

    // SECURITY: never return the c_user session JWT to the client. It is an
    // HttpOnly auth cookie; serializing it into loader JSON would expose it to
    // any XSS/devtools. No client code consumes it.
    return data({ st: sessionToken, user_agent: request.headers.get('user-agent'), userId, uploadServerUrl, userTheme, playerSettingsFromLoader, isMobileServer, isDevelopmentServer, requestURL, altAccounts }, {
      status: 200,
      headers: (token) ? { // I left this part open for now. Fix will be done later.
        'Set-Cookie': `token=${token}; Path=/; HttpOnly; ${secure}; ${sameSite}`
      } : undefined
    } as ResponseInit);
  }
  catch (error) {
    console.error('Error in root loader:', error);
    return data(null, { status: 500 });
  }
}

export const meta: MetaFunction<ReturnType<typeof loader>> = ({ data }) =>
  data ? buildDefaultMeta() : buildErrorMeta();

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useLoaderData<typeof loader>();
  if (!data || typeof data === 'string') {
    return (
       <html className="system" lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="referrer" content="strict-origin-when-cross-origin" />
          <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
          <meta name="mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-title" content={SITE_NAME} />
          <meta name="mobile-web-app-title" content={SITE_NAME} />
          <link rel="stylesheet" href="/themes/default.css" />
          <link rel="shortcut icon" href="/favicon.ico" sizes="any" type="image/x-icon" />
          <link rel="icon" href="/favicon.ico" sizes="any" type="image/x-icon" />
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

  const { st, user_agent, userId, uploadServerUrl, userTheme, playerSettingsFromLoader, isMobileServer, isDevelopmentServer, requestURL, altAccounts } = data;
  const themeClass = userTheme?.theme ?? "system";
  const themeStyle = userTheme?.style ?? "default";

  return (
    <html className={`${themeClass} overflow-hidden h-full w-full fixed top-0 left-0`} lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="referrer" content="strict-origin-when-cross-origin" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content={SITE_NAME} />
        <meta name="mobile-web-app-title" content={SITE_NAME} />
        <link rel="stylesheet" href={`${isDevelopmentServer ? requestURL : BASE_URL}/themes/${themeStyle}.css`} />
        <link rel="manifest" href={`${isDevelopmentServer ? requestURL : BASE_URL}/manifest.json`} />
        <link rel="shortcut icon" href={`${isDevelopmentServer ? requestURL : BASE_URL}/favicon.ico`} sizes="any" type="image/x-icon" />
        <link rel="icon" href={`${isDevelopmentServer ? requestURL : BASE_URL}/favicon.ico`} sizes="any" type="image/x-icon" />
        <link rel="icon" href={`${isDevelopmentServer ? requestURL : BASE_URL}/icons/web/icon-192.png`} type="image/png" sizes="192x192" />
        <link rel="icon" href={`${isDevelopmentServer ? requestURL : BASE_URL}/icons/web/icon-512.png`} type="image/png" sizes="512x512" />
        <link rel="icon" href={`${isDevelopmentServer ? requestURL : BASE_URL}/icons/web/icon-192-maskable.png`} type="image/png" sizes="192x192" />
        <link rel="icon" href={`${isDevelopmentServer ? requestURL : BASE_URL}/icons/web/icon-512-maskable.png`} type="image/png" sizes="512x512" />
        <link rel="apple-touch-icon" href={`${isDevelopmentServer ? requestURL : BASE_URL}/icons/web/apple-touch-icon.png`} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: SITE_NAME,
              url: isDevelopmentServer ? requestURL : BASE_URL,
              potentialAction: {
                "@type": "SearchAction",
                target: `${isDevelopmentServer ? requestURL : BASE_URL}/search/{search_term_string}`,
                "query-input": "required name=search_term_string",
              },
            }),
          }}
        />
        
        <Meta />
        <Links />

        <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3095543324642261" crossOrigin="anonymous"></script>
      </head>
      <body className={`flex flex-col fixed top-0 left-0 w-full h-full`}>
        <ThemeApply userTheme={userTheme ?? null} />
        <RegisterServiceWorker />
        <ErrorBoundary>
          <ContextProvider st={st} user_agent={user_agent || ''} userId={userId || null} c_user={null} uploadServerUrl={uploadServerUrl || ''} playerSettingsFromLoader={playerSettingsFromLoader ?? null} isMobileServer={isMobileServer ?? false} isDevelopment={isDevelopmentServer ?? false} altAccounts={altAccounts ?? []}>
            <LikeProvider>
              <WatchProgressProvider>
              <PictureInPictureProvider>
                <MiniPlayerProvider>
                  <WatchSurfaceVideoRefProvider>
                    <WatchPlayBootstrapProvider>
                      <WatchHlsSurfaceProvider>
                        <MainPlayerSlotProvider>
                          <RootPlayQueueProvider>
                            <GlobalPlayerLayoutProvider>
                              <CloseMiniPlayerOnNavigateToVideo />
                              <AppShell>{children}</AppShell>
                              <MiniPlayer />
                              <GlobalAnchoredHLSPlayer />
                              <SignInPrompt />
                              <PushPromptOverlay />
                            </GlobalPlayerLayoutProvider>
                          </RootPlayQueueProvider>
                        </MainPlayerSlotProvider>
                      </WatchHlsSurfaceProvider>
                    </WatchPlayBootstrapProvider>
                  </WatchSurfaceVideoRefProvider>
                </MiniPlayerProvider>
              </PictureInPictureProvider>
              </WatchProgressProvider>
            </LikeProvider>
          </ContextProvider>
        </ErrorBoundary>
        <Toaster />
        <ErrorDetailsDialog />
        <Scripts />

        <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>

      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
