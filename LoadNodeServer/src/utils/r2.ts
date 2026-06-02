// Minimal S3-compatible (Cloudflare R2) presigner. Read-only: we only need
// short-lived presigned GET URLs to proxy private objects, mirroring the
// GitHub-raw fetch path. Credentials come from env only and the presigned
// URL is used server-side; it is never sent to the browser.
import crypto from 'crypto';

const ALGORITHM = 'AWS4-HMAC-SHA256';

function hmac(key: crypto.BinaryLike, data: string): Buffer {
    return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: string): string {
    return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

// AWS SigV4 URI encoding. Operates on UTF-8 bytes; '/' kept when encodeSlash=false.
function uriEncode(input: string, encodeSlash: boolean): string {
    const bytes = Buffer.from(input, 'utf8');
    let out = '';
    for (const b of bytes) {
        const isUnreserved =
            (b >= 0x41 && b <= 0x5a) || // A-Z
            (b >= 0x61 && b <= 0x7a) || // a-z
            (b >= 0x30 && b <= 0x39) || // 0-9
            b === 0x2d || b === 0x5f || b === 0x2e || b === 0x7e; // - _ . ~
        if (isUnreserved) {
            out += String.fromCharCode(b);
        } else if (b === 0x2f && !encodeSlash) {
            out += '/';
        } else {
            out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
        }
    }
    return out;
}

export interface R2Config {
    accountId?: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    endpoint?: string;
    region?: string;
}

export class R2Client {
    private readonly scheme: string;
    private readonly host: string;
    private readonly bucket: string;
    private readonly accessKeyId: string;
    private readonly secretAccessKey: string;
    private readonly region: string;

    constructor(cfg: R2Config) {
        if (!cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucket) {
            throw new Error('r2: missing credentials or bucket');
        }
        let endpoint = (cfg.endpoint ?? '').trim().replace(/\/+$/, '');
        if (!endpoint) {
            if (!cfg.accountId) throw new Error('r2: need endpoint or accountId');
            endpoint = `https://${cfg.accountId}.r2.cloudflarestorage.com`;
        }
        const u = new URL(endpoint);
        this.scheme = u.protocol.replace(':', '');
        this.host = u.host;
        this.bucket = cfg.bucket;
        this.accessKeyId = cfg.accessKeyId;
        this.secretAccessKey = cfg.secretAccessKey;
        this.region = (cfg.region ?? 'auto') || 'auto';
    }

    getBucket(): string {
        return this.bucket;
    }

    // Returns a short-lived signed GET URL for the object key (path-style).
    presignGet(key: string, ttlSeconds = 300): string {
        if (!key) throw new Error('r2: empty key');
        const now = new Date();
        const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
        const dateStamp = amzDate.slice(0, 8);
        const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
        const canonicalURI = `/${uriEncode(this.bucket, true)}/${uriEncode(key, false)}`;
        const signedHeaders = 'host';

        const params: Array<[string, string]> = [
            ['X-Amz-Algorithm', ALGORITHM],
            ['X-Amz-Credential', `${this.accessKeyId}/${scope}`],
            ['X-Amz-Date', amzDate],
            ['X-Amz-Expires', String(ttlSeconds)],
            ['X-Amz-SignedHeaders', signedHeaders],
        ];
        params.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
        const canonicalQuery = params
            .map(([k, v]) => `${uriEncode(k, true)}=${uriEncode(v, true)}`)
            .join('&');

        const canonicalHeaders = `host:${this.host}\n`;
        const canonicalRequest = `GET\n${canonicalURI}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\nUNSIGNED-PAYLOAD`;
        const stringToSign = `${ALGORITHM}\n${amzDate}\n${scope}\n${sha256Hex(canonicalRequest)}`;

        const kDate = hmac('AWS4' + this.secretAccessKey, dateStamp);
        const kRegion = hmac(kDate, this.region);
        const kService = hmac(kRegion, 's3');
        const kSigning = hmac(kService, 'aws4_request');
        const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

        return `${this.scheme}://${this.host}${canonicalURI}?${canonicalQuery}&X-Amz-Signature=${signature}`;
    }
}

let cached: R2Client | null | undefined;

// getR2Client builds a client from R2_* env once, or null when not configured.
export function getR2Client(): R2Client | null {
    if (cached !== undefined) return cached;
    try {
        cached = new R2Client({
            accountId: process.env.R2_ACCOUNT_ID,
            accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
            bucket: process.env.R2_BUCKET ?? '',
            endpoint: process.env.R2_ENDPOINT,
            region: process.env.R2_REGION,
        });
    } catch {
        cached = null;
    }
    return cached;
}

export function r2PresignTtlSeconds(): number {
    const n = Number(process.env.R2_PRESIGN_TTL_SECONDS);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 300;
}
