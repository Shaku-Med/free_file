// import 'dotenv/config';
import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
    index("routes/Home/index.tsx"),
    route(`privacy`, 'routes/Privacy/index.tsx'),
    route(`terms`, 'routes/Terms/index.tsx'),
    route(`api`, 'routes/Api/layout.tsx', [
        route(`upload`, 'routes/Api/upload/index.tsx'),
        route(`load/video/*`, 'routes/Api/load/Video/index.tsx'),
        route(`load/image/*`, 'routes/Api/load/image/index.tsx'),
        route(`get/*`, 'routes/Api/get/index.tsx'),
        route(`public-key`, 'routes/Api/PublicKey/index.tsx'),
        route(`handshake`, 'routes/Api/handshake/index.tsx'),
        route(`socials`, 'routes/Api/Socials/layout.tsx', [
            route(`info/*`, 'routes/Api/Socials/Info.tsx'),
            route(`*`, 'routes/Api/Socials/index.tsx'),
        ]),
        route(`nsfw`, `routes/Api/load/NSFW/layout.tsx`, [
            route(`detect/*`, `routes/Api/load/NSFW/detect/index.tsx`),
        ]),
        route(`video-processor`, 'routes/Api/videoProcessor/layout.tsx', [
            route(`status/:queueID`, 'routes/Api/videoProcessor/status.tsx'),
            route(`queue-status`, 'routes/Api/videoProcessor/queue-status.tsx'),
            index('routes/Api/videoProcessor/index.tsx'),
        ]),
    ]),
    route(`:id`, 'routes/Dynamic/layout.tsx', [
        index('routes/Dynamic/index.tsx'),
    ]),
    route(`search`, 'routes/Search/layout.tsx', [
        index('routes/Search/index.tsx'),
        route('*', 'routes/Search/Dynamic/index.tsx'),
    ])
] satisfies RouteConfig;
