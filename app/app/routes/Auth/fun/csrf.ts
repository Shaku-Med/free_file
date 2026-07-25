/**
 * CSRF protection utilities
 * Generates and validates CSRF tokens for form submissions
 */

import crypto from 'crypto';

const CSRF_TOKEN_LENGTH = 32;
const CSRF_TOKEN_EXPIRY = 60 * 60 * 1000; // 1 hour

interface CSRFToken {
  token: string;
  expiresAt: number;
}

// In-memory store for CSRF tokens (in production, use Redis or database)
const tokenStore = new Map<string, CSRFToken>();

// Cleanup expired tokens every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, token] of tokenStore.entries()) {
    if (token.expiresAt < now) {
      tokenStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Generate a CSRF token
 */
export function generateCSRFToken(): string {
  return crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
}

/**
 * Create and store a CSRF token for a session
 */
export function createCSRFToken(sessionId: string): string {
  const token = generateCSRFToken();
  const expiresAt = Date.now() + CSRF_TOKEN_EXPIRY;
  
  tokenStore.set(sessionId, { token, expiresAt });
  
  return token;
}

/**
 * Validate a CSRF token
 */
export function validateCSRFToken(sessionId: string, token: string): boolean {
  const stored = tokenStore.get(sessionId);

  if (!stored) {
    return false;
  }

  // Check if expired
  if (stored.expiresAt < Date.now()) {
    tokenStore.delete(sessionId);
    return false;
  }

  // timingSafeEqual THROWS on a length mismatch, so a wrong-length token used
  // to surface as an uncaught 500 instead of a clean rejection. Compare lengths
  // first (length is not secret — the token is fixed-width), then constant-time.
  if (typeof token !== 'string' || token.length !== stored.token.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(
      Buffer.from(stored.token, 'utf8'),
      Buffer.from(token, 'utf8'),
    );
  } catch {
    return false;
  }
}

/**
 * Get session ID from request (using IP + User-Agent as fallback)
 */
export function getSessionId(request: Request): string {
  // Try to get from cookie first
  const cookies = request.headers.get('Cookie') || '';
  const sessionMatch = cookies.match(/sessionId=([^;]+)/);
  
  if (sessionMatch) {
    return sessionMatch[1];
  }
  
  // Fallback to IP + User-Agent hash
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
             request.headers.get('x-real-ip') ||
             'unknown';
  const userAgent = request.headers.get('user-agent') || 'unknown';
  
  const hash = crypto.createHash('sha256')
    .update(`${ip}:${userAgent}`)
    .digest('hex')
    .substring(0, 16);
  
  return hash;
}

/**
 * Get CSRF token from request
 */
export function getCSRFTokenFromRequest(request: Request): string | null {
  // Try form data first
  const formData = request.headers.get('content-type')?.includes('form-data');
  
  // For GET requests, check query params
  if (request.method === 'GET') {
    const url = new URL(request.url);
    return url.searchParams.get('csrf_token') || null;
  }
  
  // For POST requests, we'll need to extract from form data in the route handler
  // This is a helper that routes can use
  return null;
}
