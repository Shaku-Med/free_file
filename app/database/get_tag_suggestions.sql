-- Tag suggestions with usage count: how many places each tag appears
-- (in tags array, file_title, or file_description).
-- For public.files with tags jsonb (default '[]'::jsonb). Run in Supabase SQL editor.

create or replace function public.get_tag_suggestions(
  p_query text default null,
  p_limit int default 10
)
returns table (tag_name text, usage_count bigint)
language sql stable security definer set search_path = public
as $$
  with tag_candidates as (
    select distinct lower(trim(elem::text)) as tag_name
    from public.files,
         lateral jsonb_array_elements_text(coalesce(tags, '[]'::jsonb)) as elem
    where jsonb_typeof(coalesce(tags, '[]'::jsonb)) = 'array'
      and jsonb_array_length(coalesce(tags, '[]'::jsonb)) > 0
      and trim(elem::text) <> ''
  ),
  with_count as (
    select
      tc.tag_name,
      (
        select count(*)::bigint
        from public.files f
        where exists (
          select 1
          from jsonb_array_elements_text(coalesce(f.tags, '[]'::jsonb)) e
          where lower(trim(e::text)) = tc.tag_name
        )
           or (f.file_title ilike '%' || tc.tag_name || '%')
           or (coalesce(f.file_description, '') ilike '%' || tc.tag_name || '%')
      ) as usage_count
    from tag_candidates tc
  )
  select w.tag_name, w.usage_count
  from with_count w
  where (p_query is null or p_query = '' or w.tag_name like p_query || '%')
  order by w.usage_count desc, w.tag_name
  limit least(greatest(coalesce(p_limit, 10), 1), 100);
$$;
