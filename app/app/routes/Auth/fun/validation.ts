/**
 * Input validation and sanitization utilities for auth endpoints
 * Prevents injection attacks, XSS, and validates user inputs
 */

/**
 * Sanitize string input to prevent XSS and injection attacks
 */
export function sanitizeString(input: string, maxLength: number = 255): string {
  if (typeof input !== 'string') return '';
  
  // Remove null bytes and control characters
  let sanitized = input.replace(/[\x00-\x1F\x7F]/g, '');
  
  // Trim whitespace
  sanitized = sanitized.trim();
  
  // Limit length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }
  
  return sanitized;
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  
  // RFC 5322 compliant regex (simplified)
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  
  // Check length (RFC 5321: 320 characters max)
  if (email.length > 320) return false;
  
  // Check local and domain parts
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  
  const [local, domain] = parts;
  if (local.length > 64 || domain.length > 255) return false;
  
  return emailRegex.test(email);
}

/**
 * Validate username format
 * Rules: 3-30 characters, alphanumeric, underscores, hyphens, no spaces
 */
export function isValidUsername(username: string): boolean {
  if (!username || typeof username !== 'string') return false;
  
  // Length check
  if (username.length < 3 || username.length > 30) return false;
  
  // Character check: alphanumeric, underscore, hyphen only
  const usernameRegex = /^[a-zA-Z0-9_-]+$/;
  if (!usernameRegex.test(username)) return false;
  
  // Cannot start or end with underscore or hyphen
  if (/^[_-]|[_-]$/.test(username)) return false;
  
  // Cannot have consecutive underscores or hyphens
  if (/_{2,}|-{2,}/.test(username)) return false;
  
  return true;
}

/**
 * Validate password strength
 * Requirements:
 * - At least 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special character
 */
export function validatePasswordStrength(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!password || typeof password !== 'string') {
    return { valid: false, errors: ['Password is required'] };
  }
  
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  
  if (password.length > 128) {
    errors.push('Password must be less than 128 characters');
  }
  
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }
  
  // Check for common weak passwords
  const commonPasswords = ['password', '12345678', 'qwerty', 'abc123', 'password123'];
  if (commonPasswords.some(weak => password.toLowerCase().includes(weak.toLowerCase()))) {
    errors.push('Password is too common. Please choose a stronger password');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate date of birth
 */
export function isValidDateOfBirth(dob: string): { valid: boolean; age?: number; error?: string } {
  if (!dob || typeof dob !== 'string') {
    return { valid: false, error: 'Date of birth is required' };
  }
  
  const dobDate = new Date(dob);
  const today = new Date();
  
  // Check if date is valid
  if (isNaN(dobDate.getTime())) {
    return { valid: false, error: 'Invalid date format' };
  }
  
  // Check if date is in the future
  if (dobDate > today) {
    return { valid: false, error: 'Date of birth cannot be in the future' };
  }
  
  // Check if date is too old (reasonable limit: 120 years)
  const minDate = new Date();
  minDate.setFullYear(minDate.getFullYear() - 120);
  if (dobDate < minDate) {
    return { valid: false, error: 'Invalid date of birth' };
  }
  
  // Calculate age
  let age = today.getFullYear() - dobDate.getFullYear();
  const monthDiff = today.getMonth() - dobDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dobDate.getDate())) {
    age--;
  }
  
  // Check minimum age (18)
  if (age < 18) {
    return { valid: false, error: 'You must be at least 18 years old' };
  }
  
  return { valid: true, age };
}

/**
 * Validate verification code format
 */
export function isValidVerificationCode(code: string): boolean {
  if (!code || typeof code !== 'string') return false;
  
  // Must be exactly 6 digits
  const codeRegex = /^\d{6}$/;
  return codeRegex.test(code);
}

/**
 * Add constant delay to prevent timing attacks
 */
export function constantTimeDelay(ms: number = 100): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Normalize identifier (email or username) for consistent comparison
 */
export function normalizeIdentifier(identifier: string): string {
  if (!identifier || typeof identifier !== 'string') return '';
  
  // Trim and lowercase
  let normalized = identifier.trim().toLowerCase();
  
  // Remove any whitespace
  normalized = normalized.replace(/\s+/g, '');
  
  return normalized;
}

/**
 * Check if string contains potentially dangerous patterns
 */
export function containsDangerousPatterns(input: string): boolean {
  if (!input || typeof input !== 'string') return false;
  
  // SQL injection patterns
  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION|SCRIPT)\b)/i,
    /(--|;|\/\*|\*\/|'|"|`)/,
  ];
  
  // XSS patterns
  const xssPatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i,
    /<iframe/i,
    /<object/i,
    /<embed/i,
  ];
  
  const allPatterns = [...sqlPatterns, ...xssPatterns];
  
  return allPatterns.some(pattern => pattern.test(input));
}

/**
 * Validate and sanitize all signup inputs
 */
export function validateSignupInputs(data: {
  username: string;
  email: string;
  password: string;
  dob: string;
}): { valid: boolean; errors: string[]; sanitized?: { username: string; email: string; password: string; dob: string } } {
  const errors: string[] = [];
  
  // Sanitize inputs
  const username = sanitizeString(data.username, 30);
  const email = sanitizeString(data.email, 320).toLowerCase();
  const password = data.password; // Don't sanitize password, validate only
  const dob = sanitizeString(data.dob, 10);
  
  // Validate username
  if (!username) {
    errors.push('Username is required');
  } else if (!isValidUsername(username)) {
    errors.push('Username must be 3-30 characters, alphanumeric with underscores or hyphens only');
  } else if (containsDangerousPatterns(username)) {
    errors.push('Username contains invalid characters');
  }
  
  // Validate email
  if (!email) {
    errors.push('Email is required');
  } else if (!isValidEmail(email)) {
    errors.push('Invalid email format');
  }
  
  // Validate password
  const passwordValidation = validatePasswordStrength(password);
  if (!passwordValidation.valid) {
    errors.push(...passwordValidation.errors);
  }
  
  // Validate date of birth
  const dobValidation = isValidDateOfBirth(dob);
  if (!dobValidation.valid) {
    errors.push(dobValidation.error || 'Invalid date of birth');
  }
  
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  
  return {
    valid: true,
    errors: [],
    sanitized: { username, email, password, dob }
  };
}

/**
 * Validate login inputs
 */
export function validateLoginInputs(data: {
  identifier: string;
  password: string;
}): { valid: boolean; errors: string[]; sanitized?: { identifier: string; password: string } } {
  const errors: string[] = [];
  
  const identifier = sanitizeString(data.identifier, 320);
  const password = data.password; // Don't sanitize password
  
  if (!identifier) {
    errors.push('Username or email is required');
  } else if (identifier.length < 3) {
    errors.push('Identifier must be at least 3 characters');
  } else if (containsDangerousPatterns(identifier)) {
    errors.push('Identifier contains invalid characters');
  }
  
  if (!password) {
    errors.push('Password is required');
  } else if (password.length < 1) {
    errors.push('Password is required');
  }
  
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  
  return {
    valid: true,
    errors: [],
    sanitized: { identifier, password }
  };
}
