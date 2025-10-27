// import 'dotenv/config';
import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
    index("routes/Home/index.tsx"),
    route(`api`, 'routes/Api/layout.tsx', [
        route(`upload`, 'routes/Api/upload/index.tsx'),
        route(`load/video/*`, 'routes/Api/load/Video/index.tsx'),
        route(`load/image/*`, 'routes/Api/load/image/index.tsx'),
        route(`get/*`, 'routes/Api/get/index.tsx'),
    ]),
    route(`:id`, 'routes/Dynamic/layout.tsx', [
        index('routes/Dynamic/index.tsx'),
    ])
] satisfies RouteConfig;
