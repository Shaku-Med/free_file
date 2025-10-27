# Rate Limiting Implementation

This application now includes comprehensive rate limiting to protect against abuse and ensure fair usage of API endpoints.

## Overview

Rate limiting is implemented using a custom middleware system that tracks requests per IP address and enforces limits based on configurable time windows and request counts.

## Features

- **IP-based tracking**: Uses client IP addresses to track request rates
- **Configurable limits**: Different endpoints can have different rate limits
- **Automatic cleanup**: Expired rate limit entries are automatically cleaned up
- **HTTP headers**: Rate limit information is included in response headers
- **Graceful degradation**: Returns proper HTTP 429 status with retry information

## Layered Rate Limiting

The application implements a **layered rate limiting approach**:

1. **Global Rate Limiting**: Applied to all routes at the root middleware level
   - 200 requests per 5 minutes per IP
   - First line of defense against abuse

2. **Endpoint-Specific Rate Limiting**: Applied to individual API endpoints
   - More restrictive limits for sensitive operations
   - Allows fine-tuned control per endpoint type

This layered approach ensures comprehensive protection while allowing different endpoints to have appropriate limits for their specific use cases.

## Rate Limit Configurations

### Global Rate Limiting (All Routes)
- **Limit**: 200 requests per 5 minutes
- **Purpose**: Overall application protection against abuse
- **Key**: `global:{ip}`
- **Applied**: At the root middleware level

### Upload Endpoint (`/api/upload`)
- **Limit**: 10 requests per 15 minutes
- **Purpose**: Prevent abuse of file upload functionality
- **Key**: `upload:{ip}`

### Likes Endpoint (`/api/likes`)
- **Limit**: 30 requests per minute
- **Purpose**: Allow reasonable interaction while preventing spam
- **Key**: `likes:{ip}`

### API Endpoints (`/api/get`, `/api/load/*`)
- **Limit**: 100 requests per 15 minutes
- **Purpose**: General API usage protection
- **Key**: `api:{ip}`

### Strict Mode
- **Limit**: 5 requests per minute
- **Purpose**: For sensitive operations requiring extra protection
- **Key**: `strict:{ip}`

## Implementation Details

### Rate Limiter Class
The `RateLimiter` class manages the in-memory storage of rate limit data:

```typescript
class RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private cleanupInterval: NodeJS.Timeout;
}
```

### Rate Limit Entry
Each tracked IP has an entry containing:
- `count`: Number of requests made in current window
- `resetTime`: When the rate limit window resets

### Middleware Function
The `createRateLimit` function returns middleware that:
1. Checks if the request exceeds the limit
2. Returns 429 status if limit exceeded
3. Adds rate limit headers to all responses
4. Calls the next handler if within limits

## Response Headers

All API responses include rate limiting headers:

- `X-RateLimit-Limit`: Maximum requests allowed in the window
- `X-RateLimit-Remaining`: Requests remaining in current window
- `X-RateLimit-Reset`: When the rate limit window resets (ISO timestamp)
- `Retry-After`: Seconds to wait before retrying (only on 429 responses)

## Error Responses

When rate limits are exceeded, the API returns:

```json
{
  "error": "Too many requests",
  "retryAfter": 300
}
```

With HTTP status `429 Too Many Requests`.

## IP Detection

The system detects client IPs using the following priority:
1. `X-Forwarded-For` header (first IP if multiple)
2. `X-Real-IP` header
3. Falls back to "unknown" if neither available

## Memory Management

- Rate limit data is stored in memory for fast access
- Automatic cleanup runs every minute to remove expired entries
- No persistent storage required - limits reset on server restart

## Customization

To modify rate limits, update the `rateLimitConfigs` object in `rateLimiter.ts`:

```typescript
export const rateLimitConfigs = {
  upload: {
    windowMs: 15 * 60 * 1000,  // 15 minutes
    maxRequests: 10,            // 10 requests
    keyGenerator: (request) => `upload:${getIP(request)}`
  }
  // ... other configurations
};
```

## Security Considerations

- Rate limiting is per-IP, so users behind NAT may share limits
- No persistent storage means limits reset on server restart
- Consider implementing user-based rate limiting for authenticated endpoints
- Monitor logs for patterns of abuse and adjust limits accordingly

## Monitoring

Rate limit headers in responses allow clients to:
- Track their remaining requests
- Implement client-side throttling
- Display appropriate user messages
- Handle rate limit errors gracefully
