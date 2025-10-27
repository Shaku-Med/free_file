import {
  data,
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  type MetaFunction,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import Navbar from "./components/Navbar";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ContextProvider } from "./lib/Context/Context";
import { LikeProvider } from "./lib/Context/LikeContext";
import db from "./lib/Database/supabase";
import type { FileRecord } from "./lib/Services/FileService";
import { createRateLimit, rateLimitConfigs } from "./lib/middleware/rateLimiter";

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

const globalRateLimit = createRateLimit({
  windowMs: 5 * 60 * 1000,
  maxRequests: 200,
  keyGenerator: (request: Request) => {
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0] : 
               request.headers.get('x-real-ip') || 
               'unknown';
    return `global:${ip}`;
  }
});

const rateLimitMiddleware: Route.MiddlewareFunction = async ({ context, request }, next) => {
  const result = await globalRateLimit(request, async () => {
    return await next();
  });
  return result;
};

const userMiddleware: Route.MiddlewareFunction = async ({ context }, next) => {
  let response = await next()
  response.headers.set("Cross-Origin-Embedder-Policy", "require-corp")
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin")
  return response
};

export const middleware = [rateLimitMiddleware, userMiddleware] satisfies Route.MiddlewareFunction[]

export const loader = async () => {
  try {
    if(!db){
      throw new Error('Database not initialized');
    }
    
    const { data: files, error } = await db
      .from('files')
      .select('filename, unique_id, up_count, down_count, file_size, file_type, endpoint, created_at')
      .order('created_at', { ascending: false })
      .limit(50);

    const processedFiles = files?.map((file: FileRecord) => {
      if (!file.file_type.startsWith('image/')) {
        const { endpoint, ...fileWithoutEndpoint } = file;
        return fileWithoutEndpoint;
      }
      return file;
    }) || [];

    if (error) {
      console.error('Error fetching files:', error);
      throw new Error('Failed to fetch files');
    }

    return data({ files: processedFiles }, { status: 200 });
  }
  catch (error) {
    console.error('Error in loader:', error);
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
    console.error('Error in meta:', error);
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
    return <div>Error loading data</div>;
  }

  const { files } = data;
  return (
    <html className={`dark`} lang="en">
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
        <Meta />
        <Links />
      </head>
      <body>
        <ErrorBoundary>
          <ContextProvider f={files}>
            <LikeProvider>
              <Navbar />
              <div className={`mx-auto px-6 xl:px-8 max-w-full xl:container`}>
               {children}
              </div>
            </LikeProvider>
          </ContextProvider>
        </ErrorBoundary>
        <ScrollRestoration />
        <Scripts />

        <script src="/Editor/hls_converter.js"></script>
        <script src="/Editor/ffmpeg.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
