-- SHWETA Studio extensions: owner-only publishing support tables.
-- Run this migration in the Supabase SQL editor after deploying the matching
-- studio UI. Existing reader-facing tables and grants are left untouched.
begin;

alter table public.posts add column if not exists author_id uuid;
alter table public.posts add column if not exists author_name text not null default 'Shweta';
alter table public.posts add column if not exists seo_title text not null default '';
alter table public.posts add column if not exists seo_description text not null default '';
alter table public.posts add column if not exists canonical_url text not null default '';
alter table public.posts add column if not exists featured boolean not null default false;
alter table public.posts add column if not exists last_reviewed_at date;
alter table public.posts add column if not exists correction_note text not null default '';
alter table public.posts drop constraint if exists posts_status_check;
alter table public.posts add constraint posts_status_check
  check (status = any (array['draft','in_review','approved','scheduled','published','archived','trashed']));

create table if not exists public.studio_authors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  role text not null default 'Writer',
  bio text not null default '',
  photo_url text,
  areas text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.posts drop constraint if exists posts_author_id_fkey;
alter table public.posts add constraint posts_author_id_fkey
  foreign key (author_id) references public.studio_authors(id) on delete set null;

create table if not exists public.studio_sources (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source_type text not null default 'Official document',
  classification text not null default 'Primary',
  court_or_publisher text not null default '',
  year integer,
  citation text not null default '',
  url text not null default '',
  notes text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.studio_media (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  url text not null,
  alt_text text not null default '',
  caption text not null default '',
  credit text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.studio_corrections (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts(id) on delete set null,
  post_title text not null default '',
  details text not null,
  correction_note text not null default '',
  status text not null default 'pending' check (status in ('pending','investigating','resolved','declined')),
  created_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.studio_revisions (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.posts(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.studio_activity (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  object_type text not null,
  object_id text,
  summary text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.studio_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.studio_authors enable row level security;
alter table public.studio_sources enable row level security;
alter table public.studio_media enable row level security;
alter table public.studio_corrections enable row level security;
alter table public.studio_revisions enable row level security;
alter table public.studio_activity enable row level security;
alter table public.studio_settings enable row level security;

do $$
declare t text;
begin
  foreach t in array array['studio_authors','studio_sources','studio_media','studio_corrections','studio_revisions','studio_activity','studio_settings'] loop
    execute format('drop policy if exists %I on public.%I', t || '_owner_access', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_site_owner()) with check (public.is_site_owner())', t || '_owner_access', t);
    execute format('revoke all on public.%I from anon, public', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

drop policy if exists studio_revisions_owner_access on public.studio_revisions;
drop policy if exists studio_activity_owner_access on public.studio_activity;
create policy studio_revisions_owner_read on public.studio_revisions for select to authenticated using (public.is_site_owner());
create policy studio_activity_owner_read on public.studio_activity for select to authenticated using (public.is_site_owner());
revoke all on public.studio_revisions, public.studio_activity from anon, public;
revoke insert, update, delete on public.studio_revisions, public.studio_activity from authenticated;
grant select on public.studio_revisions, public.studio_activity to authenticated;

create or replace function public.studio_capture_post_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Post updates are authorized by posts RLS for browser users. The scheduled
  -- database job runs without an end-user JWT and must still create a revision.
  if tg_op = 'INSERT' or row(new.title,new.slug,new.subtitle,new.post_type,new.body,new.tags,new.sources,new.status,new.scheduled_at,new.author_id,new.author_name,new.seo_title,new.seo_description,new.canonical_url,new.featured,new.last_reviewed_at,new.correction_note)
       is distinct from row(old.title,old.slug,old.subtitle,old.post_type,old.body,old.tags,old.sources,old.status,old.scheduled_at,old.author_id,old.author_name,old.seo_title,old.seo_description,old.canonical_url,old.featured,old.last_reviewed_at,old.correction_note) then
    insert into public.studio_revisions(post_id,actor_id,snapshot)
    values (new.id, auth.uid(), to_jsonb(new));
    insert into public.studio_activity(actor_id,action,object_type,object_id,summary)
    values (auth.uid(), lower(tg_op), 'post', new.id::text, coalesce(new.title,'Untitled'));
  end if;
  return new;
end;
$$;

drop trigger if exists studio_posts_revision on public.posts;
create trigger studio_posts_revision
after insert or update on public.posts
for each row execute function public.studio_capture_post_revision();

create or replace function public.studio_capture_library_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare row_data jsonb;
begin
  if tg_op='DELETE' then row_data:=to_jsonb(old); else row_data:=to_jsonb(new); end if;
  insert into public.studio_activity(actor_id,action,object_type,object_id,summary)
  values (
    auth.uid(), lower(tg_op), tg_table_name,
    coalesce(row_data->>'id',row_data->>'key'),
    coalesce(row_data->>'title',row_data->>'name',row_data->>'key',row_data->>'post_title','Studio record')
  );
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['studio_authors','studio_sources','studio_media','studio_corrections','studio_settings'] loop
    execute format('drop trigger if exists studio_%I_activity on public.%I', t, t);
    execute format('create trigger studio_%I_activity after insert or update or delete on public.%I for each row execute function public.studio_capture_library_activity()', t, t);
  end loop;
end $$;

create index if not exists studio_revisions_post_created_idx on public.studio_revisions(post_id,created_at desc);
create index if not exists studio_activity_created_idx on public.studio_activity(created_at desc);
create index if not exists studio_corrections_status_created_idx on public.studio_corrections(status,created_at desc);

drop function if exists public.get_public_post_teasers();
create function public.get_public_post_teasers()
returns table (
  id uuid, title text, slug text, subtitle text, post_type text, tags text[],
  published_at timestamptz, updated_at timestamptz, author_name text,
  seo_title text, seo_description text, canonical_url text, featured boolean,
  last_reviewed_at date, correction_note text
)
language sql stable security definer set search_path = ''
as $$
  select p.id,p.title,p.slug,p.subtitle,p.post_type,p.tags,p.published_at,p.updated_at,
         p.author_name,p.seo_title,p.seo_description,p.canonical_url,p.featured,
         p.last_reviewed_at,p.correction_note
    from public.posts p
   where p.status='published'
   order by p.featured desc,p.published_at desc nulls last
   limit 100
$$;
revoke all on function public.get_public_post_teasers() from public;
grant execute on function public.get_public_post_teasers() to anon,authenticated;

commit;

