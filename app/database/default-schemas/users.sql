create table public.users (
  id uuid not null default gen_random_uuid (),
  username text not null,
  email text not null,
  dob timestamp without time zone not null,
  profile_pic text not null default 'https://memories.brozy.org/api/load/image?text=MA'::text,
  created_at timestamp without time zone null default now(),
  verified boolean not null default false,
  is_memories boolean not null default false,
  about text null default 'Hi! I''m using Memories.'::text,
  c_usr uuid not null default gen_random_uuid (),
  unverified_expire timestamp with time zone null,
  show_nsfw boolean null default false,
  theme jsonb null default '{}'::jsonb,
  constraint users_pkey primary key (id),
  constraint users_email_key unique (email),
  constraint users_id_key unique (id),
  constraint users_username_key unique (username),
  constraint users_about_max_length check (
    (
      (about is null)
      or (char_length(about) <= 500)
    )
  ),
  constraint users_must_be_18 check ((dob <= (CURRENT_DATE - '18 years'::interval)))
) TABLESPACE pg_default;