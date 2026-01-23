import {
  data,
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  useLoaderData,
  type MetaFunction,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import Navbar from "./components/Navbar";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ContextProvider } from "./lib/Context/Context";
import { LikeProvider } from "./lib/Context/LikeContext";
import { PictureInPictureProvider } from "./lib/Context/PictureInPictureContext";
import db from "./lib/Database/supabase";
import type { FileRecord } from "./lib/Services/FileService";
import { useEffect } from "react";
import Footer from "./components/components/Footer";
import ErrorMessage from "./components/ErrorMessage";
import { getCookie } from "./lib/Security/Token";
import { VerifyToken } from "./lib/Security/unsharedkeyEncryption/Combined/Verification/VerifyToken";
import SetToken from "./lib/Security/unsharedkeyEncryption/Combined/Verification/SetToken";
import { filterFilesByAccess } from "./routes/Api/fun/accessControl";
import { isAuthenticated } from "./lib/Security/Password";
import NavProgress from "./routes/Home/NavProgress/NavProgress";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "./components/ui/sidebar";
import { AppSidebar } from "./components/Navbar/components/Sidebar";
import ScrollRestoration from "./lib/Context/ScrollRestoration";
import BodyComponent from "./components/Navbar/components/BodyComponent";
import BottomPlayer from "./components/BottomPlayer";

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

    const { data: files, error } = await db.rpc('get_feed', {
      p_user_id: userId,
      p_limit: 30,
      p_seen_ids: [],
      p_liked_ids: [],
      p_disliked_ids: [],
      p_preferred_categories: [],
      p_foryou_ids: []
    });

    if (error) {
      console.error('Error fetching files:', error)
      return data(null, { status: 500 })
    }

    const filteredFiles = await filterFilesByAccess(request, files || []);

    // Enrich files with owner data
    const { ownerService } = await import('~/lib/Services/OwnerService');
    const filesWithOwners = await ownerService.enrichFilesWithOwners(filteredFiles.slice(0, 10));

    // Fetch all user likes and dislikes in one query
    let userActions = { likedFileIds: new Set<string>(), dislikedFileIds: new Set<string>() };
    if (userId && filesWithOwners.length > 0) {
      const { userActionsService } = await import('~/lib/Services/UserActionsService');
      const fileIds = filesWithOwners.map((f: any) => f.id).filter(Boolean);
      if (fileIds.length > 0) {
        const actions = await userActionsService.getUserActions(userId, fileIds);
        userActions = actions;
      }
    }

    const processedFiles = filesWithOwners.map((file: any) => {
      if (!file.file_type.startsWith('image/')) {
        return {
          id: file.id || '',
          created_at: file.created_at,
          endpoint: '',
          filename: file.filename,
          unique_id: file.unique_id,
          file_type: file.file_type,
          file_size: file.file_size,
          is_adult: file.is_adult,
          up_count: Number(file.up_count) || 0,
          down_count: Number(file.down_count) || 0,
          owner: file.owner || null,
          thumbnails: file.thumbnails || [],
          file_title: file.file_title || '',
          category: file.category || [],
        };
      }
      return {
        id: file.id || '',
        created_at: file.created_at,
        endpoint: file.endpoint || '',
        filename: file.filename,
        unique_id: file.unique_id,
        file_type: file.file_type,
        file_size: file.file_size,
        is_adult: file.is_adult,
        up_count: Number(file.up_count) || 0,
        down_count: Number(file.down_count) || 0,
        owner: file.owner || null,
        thumbnails: file.thumbnails || [],
        file_title: file.file_title || '',
        category: file.category || [],
      };
    });
    
    // For cross-site cookie sharing with image server, use SameSite=None in production
    const sameSite = process.env.NODE_ENV === 'production' ? 'SameSite=None' : 'SameSite=Lax';
    const secure = process.env.NODE_ENV === 'production' ? 'Secure' : '';

    let c_user = getCookie('c_user', request.headers);
    
    return data({ files: processedFiles, st: sessionToken, user_agent: request.headers.get('user-agent'), userId, userActions: { likedFileIds: Array.from(userActions.likedFileIds), dislikedFileIds: Array.from(userActions.dislikedFileIds) }, c_user }, {
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

  const { files, st, user_agent, userId, userActions, c_user } = data;
  const userActionsSet = {
    likedFileIds: new Set(userActions?.likedFileIds || []),
    dislikedFileIds: new Set(userActions?.dislikedFileIds || [])
  };

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
        <ErrorBoundary>
          <ContextProvider f={files} st={st} user_agent={user_agent || ''} userId={userId || null} userActions={userActionsSet} c_user={c_user || null}>
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
