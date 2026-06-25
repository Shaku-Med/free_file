-- Where each file was uploaded from: the uploader's IP/geo at upload time.
-- Lets the feed learn which regions' content a viewer prefers (a file uploaded
-- from China carries upload_country = CN, so watching it nudges the viewer's
-- regional taste toward CN).
alter table public.files
  add column if not exists upload_ip text,
  add column if not exists upload_country text,        -- ISO code, e.g. CN
  add column if not exists upload_country_name text,
  add column if not exists upload_region text,
  add column if not exists upload_city text,
  add column if not exists upload_timezone text;

create index if not exists files_upload_country_idx on public.files (upload_country);
