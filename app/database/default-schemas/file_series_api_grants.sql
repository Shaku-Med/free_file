GRANT USAGE ON SCHEMA public TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.file_series TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.files_series_episodes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.files_series_episode_items TO service_role;
