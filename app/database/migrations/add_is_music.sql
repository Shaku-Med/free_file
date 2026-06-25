-- is_music flags a file as a music track / music video. Set by the upload
-- worker (beat-regularity score or a "music" category) and used to show the
-- music icon on the card and to keep music recommendations on-theme.
-- Audio fingerprinting (original-sound detection) now only runs for music.
alter table public.files
  add column if not exists is_music boolean not null default false;

create index if not exists idx_files_is_music
  on public.files (is_music) where is_music = true;

-- Backfill: flag any existing file whose categories mention "music" (case
-- insensitive). Checks BOTH category columns: the newer `categories` jsonb
-- array and the older `category` jsonb[]. Idempotent  re-running is a no-op.
update public.files f
set is_music = true
where f.is_music = false
  and (
    exists (
      select 1
      from jsonb_array_elements_text(
        case when jsonb_typeof(f.categories) = 'array' then f.categories else '[]'::jsonb end
      ) as c
      where lower(c) like '%music%'
    )
    or exists (
      select 1
      from unnest(coalesce(f.category, '{}'::jsonb[])) as cj
      where lower(cj::text) like '%music%'
    )
  );
