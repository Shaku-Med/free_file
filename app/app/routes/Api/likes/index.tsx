import { json, type ActionFunctionArgs } from "react-router";
import { createRateLimit, rateLimitConfigs } from '../../../lib/middleware/rateLimiter';

const likesRateLimit = createRateLimit(rateLimitConfigs.likes);

export const action = async ({ request }: ActionFunctionArgs) => {
  return likesRateLimit(request, async () => {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, { status: 405 });
    }

    try {
      const body = await request.json();
      const { videoId, userClickCount, sessionId, timestamp } = body;

      if (!videoId || typeof userClickCount !== 'number' || !timestamp || !sessionId) {
        return json({ error: "Invalid request data" }, { status: 400 });
      }

      console.log('Received user like data:', {
        videoId,
        userClickCount,
        sessionId,
        timestamp: new Date(timestamp).toISOString()
      });

      return json({ 
        success: true, 
        message: `Received ${userClickCount} user clicks for video ${videoId} from session ${sessionId}` 
      });
    } catch (error) {
      console.error('Error processing like data:', error);
      return json({ error: "Internal server error" }, { status: 500 });
    }
  });
};
