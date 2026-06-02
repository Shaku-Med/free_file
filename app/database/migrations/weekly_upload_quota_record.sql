-- record_upload_usage: unconditionally record (upsert) an upload's byte cost,
-- used by the upload webhook so usage is tracked for uploads that go straight
-- to the Go upload server (which bypasses the app's reserve step). Idempotent
-- by upload_id; no limit gate (it records what already happened).
create or replace function public.record_upload_usage(
  p_user_id   uuid,
  p_upload_id text,
  p_bytes     bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null or p_upload_id is null or p_upload_id = '' then
    return jsonb_build_object('ok', false);
  end if;
  if p_bytes is null or p_bytes < 0 then
    p_bytes := 0;
  end if;
  insert into upload_quota_ledger (user_id, upload_id, bytes, status)
  values (p_user_id, p_upload_id, p_bytes, 'committed')
  on conflict (upload_id) do update
    set bytes = excluded.bytes,
        status = 'committed',
        updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.record_upload_usage(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.record_upload_usage(uuid, text, bigint) to service_role;
