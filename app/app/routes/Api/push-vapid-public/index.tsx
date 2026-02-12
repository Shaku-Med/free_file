/**
 * GET /api/push-vapid-public
 * Returns the VAPID public key for the client to subscribe to push.
 * No auth required (the key is public).
 */
const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const loader = async () => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return toJson({ error: "Something went wrong." }, 503);
  }
  return toJson({ publicKey });
};
