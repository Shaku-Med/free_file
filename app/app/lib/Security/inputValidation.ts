/**
 * Security utilities for input validation and sanitization
 */

/**
 * Sanitize string input to prevent injection attacks
 */
export function sanitizeString(input: string | null | undefined, maxLength: number = 1000): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Remove null bytes
  let sanitized = input.replace(/\0/g, '');
  
  // Limit length to prevent DoS
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  // Trim whitespace
  sanitized = sanitized.trim();

  return sanitized;
}

/**
 * Validate and sanitize search query
 */
export function sanitizeSearchQuery(query: string | null | undefined): string {
  const sanitized = sanitizeString(query, 200);
  
  // Remove potentially dangerous characters for SQL/NoSQL injection
  // Supabase uses parameterized queries, but we still sanitize for safety
  return sanitized.replace(/[<>'"`;\\]/g, '');
}

/**
 * Validate UUID format
 */
export function isValidUUID(id: string | null | undefined): boolean {
  if (!id || typeof id !== 'string') {
    return false;
  }
  
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

/**
 * Validate file ID (UUID or alphanumeric with dashes/underscores)
 */
export function isValidFileId(id: string | null | undefined): boolean {
  if (!id || typeof id !== 'string') {
    return false;
  }
  
  // Allow UUIDs or alphanumeric IDs with dashes/underscores, max 100 chars
  const fileIdRegex = /^[a-zA-Z0-9_-]{1,100}$/;
  return fileIdRegex.test(id);
}

/**
 * Sanitize file path to prevent path traversal
 */
export function sanitizeFilePath(path: string | null | undefined): string | null {
  if (!path || typeof path !== 'string') {
    return null;
  }

  // Remove null bytes
  let sanitized = path.replace(/\0/g, '');
  
  // Remove path traversal sequences
  sanitized = sanitized.replace(/\.\./g, '');
  sanitized = sanitized.replace(/\/\.\./g, '');
  sanitized = sanitized.replace(/\.\.\//g, '');
  
  // Remove leading/trailing slashes
  sanitized = sanitized.replace(/^\/+|\/+$/g, '');
  
  // Limit length
  if (sanitized.length > 500) {
    return null;
  }

  // Allow Unicode characters (including emojis) but block dangerous characters
  // Block: control characters, path traversal, and shell injection characters
  // This approach allows international characters and emojis in filenames
  const dangerousChars = /[\x00-\x1F\x7F<>'"`;\\|&$!*?{}]/;
  if (dangerousChars.test(sanitized)) {
    return null;
  }
  
  // Ensure the path is not empty after sanitization
  if (sanitized.length === 0) {
    return null;
  }

  return sanitized;
}

/**
 * Validate integer within range
 */
export function validateInteger(
  value: string | number | null | undefined,
  min: number = 0,
  max: number = Number.MAX_SAFE_INTEGER
): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const num = typeof value === 'string' ? parseInt(value, 10) : value;
  
  if (isNaN(num) || !isFinite(num)) {
    return null;
  }

  if (num < min || num > max) {
    return null;
  }

  return num;
}

/**
 * Validate pagination parameters
 */
export function validatePagination(
  page: string | number | null | undefined,
  limit: string | number | null | undefined,
  maxLimit: number = 100
): { page: number; limit: number } | null {
  const validatedPage = validateInteger(page, 1, 1000);
  const validatedLimit = validateInteger(limit, 1, maxLimit);

  if (validatedPage === null || validatedLimit === null) {
    return null;
  }

  return { page: validatedPage, limit: validatedLimit };
}

/**
 * Sanitize comment content
 */
export function sanitizeCommentContent(content: string | null | undefined, maxLength: number = 5000): string {
  const sanitized = sanitizeString(content, maxLength);
  
  // Remove script tags and event handlers
  return sanitized
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/javascript:/gi, '');
}

/**
 * Validate email format (basic)
 */
export function isValidEmail(email: string | null | undefined): boolean {
  if (!email || typeof email !== 'string') {
    return false;
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
}

/**
 * Validate username format
 */
export function isValidUsername(username: string | null | undefined): boolean {
  if (!username || typeof username !== 'string') {
    return false;
  }
  
  // 3-30 characters, alphanumeric, underscores, hyphens
  const usernameRegex = /^[a-zA-Z0-9_-]{3,30}$/;
  return usernameRegex.test(username);
}
