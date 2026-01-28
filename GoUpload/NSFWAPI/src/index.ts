import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { NSFWDetectionService, preloadNSFWPipeline } from './services/NSFWDetectionService.js';

dotenv.config();

const app = express();
const port = Number(process.env.NSFW_API_PORT) || 3004;
const nsfwService = new NSFWDetectionService();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(
  cors({
    origin: '*',
    credentials: false,
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
  })
);

app.post('/api/nsfw/detect', async (req, res) => {
  const { image, mimeType } = req.body || {};

  if (!image || typeof image !== 'string' || !mimeType || typeof mimeType !== 'string') {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  try {
    const buffer = Buffer.from(image, 'base64');
    const isNSFW = await nsfwService.detectNSFW(buffer, mimeType);
    res.status(200).json({ isNSFW });
  } catch {
    res.status(500).json({ error: 'Detection failed' });
  }
});

const start = async () => {
  await preloadNSFWPipeline();

  app.listen(port, () => {
    process.stdout.write(`NSFW API listening on port ${port}\n`);
  });
};

start().catch(error => {
  process.stderr.write(`Failed to start NSFW API: ${String(error)}\n`);
  process.exit(1);
});

