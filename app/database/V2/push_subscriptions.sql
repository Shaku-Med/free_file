-- ============================================================
-- Push subscriptions for Web Push (one per browser/device per user)
-- ============================================================
-- Server needs VAPID keys in env. Generate with:
--   npx web-push generate-vapid-keys
-- Then set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env
-- ============================================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  endpoint   text NOT NULL,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id),
  CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE CASCADE,
  CONSTRAINT push_subscriptions_endpoint_unique UNIQUE (endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON public.push_subscriptions (user_id);

GRANT SELECT, INSERT, DELETE ON public.push_subscriptions TO authenticated;
GRANT SELECT ON public.push_subscriptions TO anon;
