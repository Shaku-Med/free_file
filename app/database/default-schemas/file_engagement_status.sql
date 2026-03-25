create materialized view public.file_engagement_stats as
select
  f.id as file_id,
  COALESCE(lk.cnt, 0::bigint) as like_count,
  COALESCE(dk.cnt, 0::bigint) as dislike_count,
  COALESCE(cm.cnt, 0::bigint) as comment_count
from
  files f
  left join (
    select
      likes.file_id,
      count(*) as cnt
    from
      likes
    group by
      likes.file_id
  ) lk on lk.file_id = f.id
  left join (
    select
      dislike.file_id,
      count(*) as cnt
    from
      dislike
    group by
      dislike.file_id
  ) dk on dk.file_id = f.id
  left join (
    select
      comments.file_id,
      count(*) as cnt
    from
      comments
    where
      comments.is_deleted = false
    group by
      comments.file_id
  ) cm on cm.file_id = f.id;