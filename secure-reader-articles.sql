-- Apply only after the matching public-content.js deployment is live.
-- Public visitors receive safe article teasers from the RPC below; full post
-- rows (including body and sources) remain available only to signed-in users.
begin;

create or replace function public.get_public_post_teasers()
returns table (
  id uuid,
  title text,
  slug text,
  subtitle text,
  post_type text,
  tags text[],
  published_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.title, p.slug, p.subtitle, p.post_type, p.tags, p.published_at, p.updated_at
  from public.posts as p
  where p.status = 'published'
  order by p.published_at desc nulls last
  limit 100
$$;

revoke all on function public.get_public_post_teasers() from public;
grant execute on function public.get_public_post_teasers() to anon, authenticated;

drop policy if exists "public reads published posts" on public.posts;
revoke all on table public.posts from anon;
revoke all on table public.posts from public;
grant select, insert, update, delete on table public.posts to authenticated;

commit;
