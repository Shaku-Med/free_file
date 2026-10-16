/**
 * Retired. Every upload goes through GoUpload (`free_file/GoUpload`), which
 * stores it on R2. This route used to run an old server to server pipeline
 * that wrote straight to GitHub, and GitHub takes no new uploads any more.
 *
 * Client upload UI lives in:
 *   - `app/routes/Home/components/MediaSelectionModal.tsx`  → GoUpload chunked API
 *   - `app/lib/uploadAuth.client.ts`                        → auth + health check
 */
export const action = async () =>
  new Response(JSON.stringify({ error: "Uploads go through the upload server." }), {
    status: 410,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
