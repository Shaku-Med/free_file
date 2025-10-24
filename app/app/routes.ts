import 'dotenv/config';
import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
    index("routes/Home/index.tsx"),
    route(`api`, 'routes/Api/layout.tsx', [
        route(`upload`, 'routes/Api/upload/index.tsx'),
        route(`load/video/*`, 'routes/Api/load/Video/index.tsx'),
    ])
] satisfies RouteConfig;
