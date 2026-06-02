-- Returns every image attachment under a comment + all its descendant replies
-- (recursive). Used by CommentService.deleteComment to gather R2 keys before
-- the soft-delete so we can purge them from storage and stop paying to host
-- content the user already nuked.
create or replace function public.get_comment_tree_images(p_comment_id uuid)
returns table (
  comment_id        uuid,
  image_url         text,
  storage_backend   text,
  image_github_repo text
)
language sql
stable
security definer
set search_path = public
as $$
  with recursive tree as (
    select id, image_url, storage_backend, image_github_repo, parent_id
    from comments
    where id = p_comment_id
    union all
    select c.id, c.image_url, c.storage_backend, c.image_github_repo, c.parent_id
    from comments c
    inner join tree t on c.parent_id = t.id
    where coalesce(c.is_deleted, false) = false
  )
  select id, image_url, storage_backend, image_github_repo
  from tree
  where image_url is not null and image_url <> '';
$$;

revoke all on function public.get_comment_tree_images(uuid) from public, anon, authenticated;
grant execute on function public.get_comment_tree_images(uuid) to service_role;
