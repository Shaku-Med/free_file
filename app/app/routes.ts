// import 'dotenv/config';
import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
    index("routes/Home/index.tsx"),
    route(`privacy`, 'routes/Privacy/index.tsx'),
    route(`terms`, 'routes/Terms/index.tsx'),
    route(`api`, 'routes/Api/layout.tsx', [
        route(`upload`, 'routes/Api/upload/index.tsx'),
        route(`upload/status/:jobId`, 'routes/Api/upload/Status.$jobId.tsx'),
        route(`load/video/*`, 'routes/Api/load/Video/index.tsx'),
        route(`load/image/*`, 'routes/Api/load/image/index.tsx'),
        // route(`get/*`, 'routes/Api/get/index.tsx'),
        route(`public-key`, 'routes/Api/PublicKey/index.tsx'),
        route(`handshake`, 'routes/Api/handshake/index.tsx'),
        route(`email`, 'routes/Api/email/index.tsx'),
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
        route(`likes`, 'routes/Api/likes/index.tsx'),
        route(`dislikes`, 'routes/Api/dislikes/index.tsx'),
        route(`comments`, 'routes/Api/comments/index.tsx'),
        route(`profile`, 'routes/Api/profile/index.tsx'),
        route(`settings`, 'routes/Api/settings/index.tsx'),
        route(`files`, 'routes/Api/files/index.tsx'),
        route(`user-profile`, 'routes/Api/user-profile/index.tsx'),
        route(`user-files`, 'routes/Api/user-files/index.tsx'),
        route(`owner-videos`, 'routes/Api/owner-videos/index.tsx'),
        route(`related-videos`, 'routes/Api/related-videos/index.tsx'),
        route(`download`, 'routes/Api/download/index.tsx'),
        route(`download/status`, 'routes/Api/download/status.tsx'),
        route(`download/cancel`, 'routes/Api/download/cancel.tsx'),
        route(`download/file/:fileId`, 'routes/Api/download/file.$fileId.tsx'),
        route(`recommendations`, 'routes/Api/recommendations/index.tsx'),
        route(`trending`, 'routes/Api/trending/index.tsx'),
        route(`feed`, 'routes/Api/feed/index.tsx'),
        route(`views/increment`, 'routes/Api/views/increment.tsx'),
        route(`server-env`, 'routes/Api/server-env/index.tsx'),
    ]),
    route(`:id`, 'routes/Dynamic/layout.tsx', [
        index('routes/Dynamic/index.tsx'),
    ]),
    route(`search`, 'routes/Search/layout.tsx', [
        index('routes/Search/index.tsx'),
        route('*', 'routes/Search/Dynamic/index.tsx'),
    ]),
    route(`features`, 'routes/Features/layout.tsx', [
        route(`incoming`, 'routes/Features/Incoming/index.tsx'),
    ]),
    route(`auth`, 'routes/Auth/layout.tsx', [
        route(`login`, 'routes/Auth/Login/index.tsx'),
        route(`signup`, 'routes/Auth/Signup/index.tsx'),
        route(`verify`, 'routes/Auth/Verify/index.tsx'),
        route(`reset`, 'routes/Auth/Reset/index.tsx'),
        route(`reset/confirm`, 'routes/Auth/Reset/confirm.tsx'),
    ]),
    route(`logout`, 'routes/Auth/Logout/index.tsx'),
    route(`settings`, 'routes/Settings/index.tsx'),
    route(`profile/:username`, 'routes/Profile/index.tsx'),
    route(`reel`, 'routes/reel/layout.tsx', [
        index('routes/reel/index.tsx'),
    ]),
] satisfies RouteConfig;
