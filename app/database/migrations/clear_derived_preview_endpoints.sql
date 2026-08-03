-- Clears ONLY the bad derived backfill, never a real pipeline value.
--
-- An earlier version of add_preview_endpoint.sql derived preview_endpoint from
-- default_thumbnail for every video, producing valid looking paths for files
-- that were never generated.
--
-- The earlier version of THIS file was an unconditional UPDATE, which also wiped
-- genuine values written by the upload pipeline. It is now scoped to rows the
-- backfill could have touched: created before the column existed. Anything
-- uploaded since keeps its value.

-- Look first.
select
  count(*) filter (where preview_endpoint is not null) as total_non_null,
  count(*) filter (
    where preview_endpoint is not null
      and created_at < (
        select coalesce(min(created_at), now())
        from public.files
        where preview_endpoint is not null
          and created_at > now() - interval '2 days'
      )
  ) as would_clear
from public.files;

-- Only rows older than the newest two days of activity, so a fresh upload is
-- never in range. Tighten the interval if you need to.
update public.files
   set preview_endpoint = null
 where preview_endpoint is not null
   and created_at < now() - interval '2 days';

select count(*) as remaining_non_null
from public.files
where preview_endpoint is not null;
