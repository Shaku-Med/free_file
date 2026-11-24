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
  const { image, isGrid, gateOnly } = req.body || {};

  console.log(`[detect] >>> Incoming request | image present: ${!!image} | image type: ${typeof image} | image length: ${typeof image === 'string' ? image.length : 0} chars | isGrid: ${isGrid === true} | gateOnly: ${gateOnly === true}`);

  if (!image || typeof image !== 'string') {
    console.log('[detect] >>> REJECTED: missing or invalid image field');
    res.status(400).json({ error: 'Invalid payload: image (base64 string) is required' });
    return;
  }

  try {
    console.log(`[detect] >>> Calling Vision API with ${image.length} chars of base64...`);
    const startTime = Date.now();
    const result = await visionService.detect(image, isGrid === true, gateOnly === true);
    const elapsed = Date.now() - startTime;
    console.log(`[detect] >>> Vision API responded in ${elapsed}ms`);
    console.log(`[detect] >>> isNSFW: ${result.isNSFW} category: ${result.category ?? 'none'} (${result.flagReason || 'clean'})`);
    console.log(`[detect] >>> safeSearch:`, JSON.stringify(result.safeSearch));
    console.log(`[detect] >>> labels (${result.labels.length}):`, result.labels.map(l => `${l.name}(${l.score})`).join(', '));
    res.status(200).json(result);
  } catch (err) {
    console.error(`[detect] >>> ERROR: ${String(err)}`);
    res.status(500).json({
      error: 'Detection failed',
      isNSFW: false,
      category: null,
      flagReason: '',
      safeSearch: null,
      labels: [],
      suggestedCategories: [],
      suggestedTags: [],
    });
  }
});

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

// Gore check on the 1 to 3 images behind a harmful verdict. 502 when one
// can't be checked; the caller then keeps the file private.
app.post('/api/nsfw/gore', async (req, res) => {
  const images = (req.body || {}).images;
  if (
    !Array.isArray(images) ||
    images.length === 0 ||
    images.length > 3 ||
    images.some((i: unknown) => typeof i !== 'string' || !BASE64.test(i))
  ) {
    res.status(400).json({ error: 'Invalid payload: images (1 to 3 base64 strings) is required' });
    return;
  }
  try {
    const startTime = Date.now();
    const gore = await visionService.confirmGore(images as string[]);
    console.log(`[gore] ${images.length} image(s) gore=${gore} in ${Date.now() - startTime}ms`);
    res.status(200).json({ gore });
  } catch (err) {
    console.error(`[gore] FAILED: ${String(err)}`);
    res.status(502).json({ error: 'Gore check failed' });
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
