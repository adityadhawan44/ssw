-- Apply after the contact page is deployed. Public callers may submit a request
-- through the validated RPC, but can never read or modify the private inbox.
begin;

create table if not exists public.studio_inquiries (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('correction','editorial','collaboration','privacy')),
  name text not null,
  email text not null,
  subject text not null,
  page_url text not null default '',
  message text not null,
  status text not null default 'new' check (status in ('new','in_progress','resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.studio_inquiries enable row level security;
revoke all on public.studio_inquiries from anon, public;
grant select, update on public.studio_inquiries to authenticated;
drop policy if exists studio_inquiries_owner_read on public.studio_inquiries;
create policy studio_inquiries_owner_read on public.studio_inquiries
  for select to authenticated using (public.is_site_owner());
drop policy if exists studio_inquiries_owner_update on public.studio_inquiries;
create policy studio_inquiries_owner_update on public.studio_inquiries
  for update to authenticated using (public.is_site_owner()) with check (public.is_site_owner());

create index if not exists studio_inquiries_status_created_idx
  on public.studio_inquiries(status,created_at desc);
create index if not exists studio_inquiries_email_created_idx
  on public.studio_inquiries(lower(email),created_at desc);

create or replace function public.submit_editorial_request(
  p_kind text, p_name text, p_email text, p_subject text, p_url text,
  p_message text, p_website text default ''
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare recent_count integer;
begin
  -- Honeypot: silently accept automated submissions without storing them.
  if coalesce(trim(p_website),'') <> '' then return true; end if;
  if p_kind not in ('correction','editorial','collaboration','privacy')
     or length(trim(coalesce(p_name,''))) not between 1 and 100
     or length(trim(coalesce(p_email,''))) not between 3 and 254
     or trim(p_email) !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'
     or length(trim(coalesce(p_subject,''))) not between 1 and 180
     or length(trim(coalesce(p_url,''))) > 500
     or (trim(coalesce(p_url,'')) <> '' and trim(p_url) !~* '^https?://')
     or length(trim(coalesce(p_message,''))) not between 1 and 5000 then
    raise exception 'Invalid editorial request';
  end if;

  select count(*) into recent_count from public.studio_inquiries
   where lower(email)=lower(trim(p_email)) and created_at > now()-interval '15 minutes';
  if recent_count >= 3 then return false; end if;

  insert into public.studio_inquiries(kind,name,email,subject,page_url,message)
  values (p_kind,trim(p_name),lower(trim(p_email)),trim(p_subject),trim(coalesce(p_url,'')),trim(p_message));
  return true;
end;
$$;

revoke all on function public.submit_editorial_request(text,text,text,text,text,text,text) from public;
grant execute on function public.submit_editorial_request(text,text,text,text,text,text,text) to anon,authenticated;
commit;
