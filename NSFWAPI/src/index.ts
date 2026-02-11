import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { VisionService } from './services/VisionService.js';

dotenv.config();

const app = express();
const port = Number(process.env.NSFW_API_PORT) || 3004;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(
  cors({
    origin: '*',
    credentials: false,
    methods: ['POST', 'GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Webhook-Secret'],
  })
);

let visionService: VisionService;

app.post('/api/nsfw/detect', async (req, res) => {
  const { image } = req.body || {};

  console.log(`[detect] >>> Incoming request | image present: ${!!image} | image type: ${typeof image} | image length: ${typeof image === 'string' ? image.length : 0} chars`);

  if (!image || typeof image !== 'string') {
    console.log('[detect] >>> REJECTED: missing or invalid image field');
    res.status(400).json({ error: 'Invalid payload: image (base64 string) is required' });
    return;
  }

  try {
    console.log(`[detect] >>> Calling Vision API with ${image.length} chars of base64...`);
    const startTime = Date.now();
    const result = await visionService.detect(image);
    const elapsed = Date.now() - startTime;
    console.log(`[detect] >>> Vision API responded in ${elapsed}ms`);
    console.log(`[detect] >>> isNSFW: ${result.isNSFW}`);
    console.log(`[detect] >>> safeSearch:`, JSON.stringify(result.safeSearch));
    console.log(`[detect] >>> labels (${result.labels.length}):`, result.labels.map(l => `${l.name}(${l.score})`).join(', '));
    res.status(200).json(result);
  } catch (err) {
    console.error(`[detect] >>> ERROR: ${String(err)}`);
    res.status(500).json({
      error: 'Detection failed',
      isNSFW: false,
      safeSearch: null,
      labels: [],
    });
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', engine: 'google-vision' });
});

const start = async () => {
  visionService = new VisionService();

  app.listen(port, () => {
    process.stdout.write(`Vision NSFW API listening on port ${port}\n`);
  });
};

start().catch((error) => {
  process.stderr.write(`Failed to start API: ${String(error)}\n`);
  process.exit(1);
});
