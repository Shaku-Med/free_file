import express from 'express';
import cors from 'cors';
import { initializeEnv, refreshEnv } from './utils/envFetcher.js';
import { reinitializeDatabase } from './utils/database.js';
import { getServerToServerBaseURL } from './utils/url.js';
import { startLoadMonitor, getLoadSnapshot } from './utils/cache/loadMonitor.js';
import { rateLimit } from './utils/cache/rateLimit.js';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const PORT = 3001;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(cors({
    origin: '*',
    credentials: true,
    methods: ['GET', 'OPTIONS', 'HEAD'],
    allowedHeaders: ['Content-Type', 'Cookie', 'c-user', 'Authorization'],
    exposedHeaders: ['Content-Type', 'Cache-Control'],
    preflightContinue: false,
    optionsSuccessStatus: 204
}));


const MAIN_APP_URL = getServerToServerBaseURL();
const SERVER_TO_SERVER_KEY = process.env.SERVER_TO_SERVER_KEY;
const SERVER_TO_SERVER_KEY_1 = process.env.SERVER_TO_SERVER_KEY_1;
const SERVER_TO_SERVER_KEY_2 = process.env.SERVER_TO_SERVER_KEY_2;

if (!SERVER_TO_SERVER_KEY_1 || !SERVER_TO_SERVER_KEY_2 || !SERVER_TO_SERVER_KEY || !MAIN_APP_URL) {
    console.error('SERVER_TO_SERVER_KEY_1 and SERVER_TO_SERVER_KEY_2 are required for server-to-server communication');
    console.error('Please set both keys in your .env file or environment variables');
    process.exit(1);
}

let envInitialized = false;

const startServer = async () => {
    console.log(`Attempting to fetch environment variables from ${MAIN_APP_URL}/api/server-env`);
    const success = await initializeEnv(MAIN_APP_URL);
    if (!success) {
        console.error('Failed to initialize environment variables. Retrying in 5 seconds...');
        setTimeout(startServer, 5000);
        return;
    }

    reinitializeDatabase();
    envInitialized = true;

    const imageRouter = (await import('./routes/image.js')).default;
    const profilepicRouter = (await import('./routes/profilepic.js')).default;
    // Same deferred import as the others: routers must not load until
    // reinitializeDatabase() above has run, or they capture an uninitialised client.
    const previewRouter = (await import('./routes/preview.js')).default;

    app.use('/api/load/image', rateLimit, imageRouter);
    app.use('/api/load/profilepic', rateLimit, profilepicRouter);
    app.use('/api/load/preview', rateLimit, previewRouter);

    startLoadMonitor();

    // RSS / heap / lag + cache stats. Metrics only, no secrets.
    // Set HEALTH_TOKEN to require ?token=<value>; leave unset for public health.
    app.get('/health', (req, res) => {
        const required = process.env.HEALTH_TOKEN;
        if (required && req.query.token !== required) {
            return res.status(404).send(null);
        }
        const snap = getLoadSnapshot();
        res.set('Cache-Control', 'no-store');
        res.json({ ok: true, ...snap });
    });

    // Unmatched routes  return 404, NOT 401. This is a public CDN; nothing
    // here requires authentication. Returning 401 was the original cause of
    // image tags failing because <img> can't send credentials and would
    // surface "Unauthorized" instead of the correct "Not Found".
    app.use('*', (req, res) => {
        res.status(404).send(null);
    });

    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
};

process.on('uncaughtException', async (error) => {
    console.error('Uncaught exception:', error);
    if (!envInitialized) {
        await refreshEnv(MAIN_APP_URL);
    }
});

process.on('unhandledRejection', async (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
    if (!envInitialized) {
        await refreshEnv(MAIN_APP_URL);
    }
});

const checkEnvAccess = async () => {
    if (!envInitialized) {
        return;
    }

    const requiredKeys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'GITHUB_OWNER'];
    const missingKeys = requiredKeys.filter(key => !process.env[key]);

    if (missingKeys.length > 0) {
        console.warn('Missing environment variables detected. Refreshing...');
        const refreshed = await refreshEnv(MAIN_APP_URL);
        if (refreshed) {
            reinitializeDatabase();
        }
    }
};

setInterval(checkEnvAccess, 60000);

startServer();
