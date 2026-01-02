import express from 'express';
import cors from 'cors';
import { initializeEnv, refreshEnv } from './utils/envFetcher.js';
import { reinitializeDatabase } from './utils/database.js';
import { getServerToServerBaseURL } from './utils/url.js';
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

    app.use('/api/load/image', imageRouter);

    app.use('*', (req, res) => {
        res.status(401).send(null);
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
