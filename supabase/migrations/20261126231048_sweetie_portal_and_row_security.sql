create schema if not exists sweetie_private;
revoke all on schema sweetie_private from public, anon, authenticated;
grant usage on schema sweetie_private to authenticated;
create table sweetie_private.admin_emails (
  email text primary key check (email = lower(email))
);
create function sweetie_private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u
    join sweetie_private.admin_emails a on a.email = lower(u.email)
    where u.id = (select auth.uid()) and u.email_confirmed_at is not null
      and coalesce((select auth.jwt())->>'is_anonymous','false') = 'false'
  );
$$;
revoke all on function sweetie_private.is_admin() from public, anon, authenticated;
grant execute on function sweetie_private.is_admin() to authenticated;

create table public.sweetie_profiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  display_name text not null check(char_length(btrim(display_name)) between 1 and 100),
  company text not null default '' check(char_length(company) <= 120)
);
create table public.sweetie_equipment (
  id bigint generated always as identity primary key,
  product text not null check(product in ('refurb','fresh','latitude','pro14')),
  tier text not null check(tier in ('standard','advanced')),
  ram integer not null check(ram in (8,16,32)),
  ssd integer not null check(ssd in (256,512,1024)),
  stock integer not null check(stock between 0 and 100000),
  price integer not null check(price between 1 and 10000000),
  unique(product,tier,ram,ssd)
);
create table public.sweetie_accessories (
  accessory text primary key check(accessory in ('monitor','keyboard','mouse','headset')),
  name text not null,
  stock integer not null check(stock between 0 and 100000),
  price integer not null check(price between 1 and 10000000)
);
create table public.sweetie_contracts (
  id uuid primary key default gen_random_uuid(),
  folio text not null unique check(char_length(btrim(folio)) between 1 and 60),
  client text not null check(char_length(btrim(client)) between 1 and 140),
  starts_on date not null,
  ends_on date not null check(ends_on >= starts_on),
  notes text not null default '' check(char_length(notes) <= 600)
);
create table public.sweetie_quotes (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  company text not null check(char_length(btrim(company)) between 1 and 100),
  budget integer not null check(budget between 1 and 1000000000),
  total integer not null check(total between 0 and budget),
  requested integer not null check(requested > 0),
  assigned integer not null check(assigned between 0 and requested),
  details jsonb not null check(jsonb_typeof(details) = 'object' and octet_length(details::text) <= 150000)
);
create index sweetie_quotes_user_created on public.sweetie_quotes(user_id,created_at desc);

alter table public.sweetie_profiles enable row level security;
alter table public.sweetie_equipment enable row level security;
alter table public.sweetie_accessories enable row level security;
alter table public.sweetie_contracts enable row level security;
alter table public.sweetie_quotes enable row level security;
revoke all on public.sweetie_profiles, public.sweetie_equipment, public.sweetie_accessories, public.sweetie_contracts, public.sweetie_quotes from public, anon, authenticated;
grant select,insert on public.sweetie_profiles to authenticated;
grant update(display_name, company) on public.sweetie_profiles to authenticated;
grant select on public.sweetie_equipment,public.sweetie_accessories to authenticated;
grant update(stock,price) on public.sweetie_equipment,public.sweetie_accessories to authenticated;
grant select,insert,update on public.sweetie_contracts to authenticated;
grant select,insert on public.sweetie_quotes to authenticated;
create policy profile_read on public.sweetie_profiles for select to authenticated using (user_id = (select auth.uid()));
create policy profile_insert on public.sweetie_profiles for insert to authenticated with check (user_id = (select auth.uid()));
create policy profile_update on public.sweetie_profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy equipment_read on public.sweetie_equipment for select to authenticated using (coalesce((select auth.jwt())->>'is_anonymous','false') = 'false' and (stock > 0 or (select sweetie_private.is_admin())));
create policy equipment_update on public.sweetie_equipment for update to authenticated using ((select sweetie_private.is_admin())) with check ((select sweetie_private.is_admin()));
create policy accessories_read on public.sweetie_accessories for select to authenticated using (coalesce((select auth.jwt())->>'is_anonymous','false') = 'false');
create policy accessories_update on public.sweetie_accessories for update to authenticated using ((select sweetie_private.is_admin())) with check ((select sweetie_private.is_admin()));
create policy contracts_read on public.sweetie_contracts for select to authenticated using ((select sweetie_private.is_admin()));
create policy contracts_insert on public.sweetie_contracts for insert to authenticated with check ((select sweetie_private.is_admin()));
create policy contracts_update on public.sweetie_contracts for update to authenticated using ((select sweetie_private.is_admin())) with check ((select sweetie_private.is_admin()));
create policy quote_read on public.sweetie_quotes for select to authenticated using (user_id = (select auth.uid()));
create policy quote_insert on public.sweetie_quotes for insert to authenticated with check (user_id = (select auth.uid()));

create function public.sweetie_admin_status() returns boolean
language sql stable security invoker set search_path = '' as $$
  select sweetie_private.is_admin();
$$;
revoke all on function public.sweetie_admin_status() from public, anon, authenticated;
grant execute on function public.sweetie_admin_status() to authenticated;

insert into public.sweetie_equipment(product,tier,ram,ssd,stock,price) values
('refurb','standard',8,256,35,6700),
('refurb','standard',16,512,66,7800),
('refurb','standard',16,1024,12,8900),
('refurb','advanced',16,512,10,10800),
('refurb','advanced',32,512,16,11800),
('refurb','advanced',32,1024,10,12900),
('fresh','standard',8,256,28,10000),
('fresh','standard',16,512,36,11300),
('fresh','standard',16,1024,20,12300),
('fresh','advanced',16,512,8,15500),
('fresh','advanced',32,512,15,16400),
('fresh','advanced',32,1024,12,17400),
('latitude','standard',8,256,15,9500),
('latitude','standard',16,512,26,11600),
('latitude','standard',16,1024,8,12600),
('latitude','advanced',16,512,10,14000),
('latitude','advanced',32,512,16,15300),
('latitude','advanced',32,1024,12,16900),
('pro14','standard',8,256,20,13800),
('pro14','standard',16,512,31,16100),
('pro14','standard',16,1024,18,17300),
('pro14','advanced',16,512,12,19100),
('pro14','advanced',32,512,12,20500),
('pro14','advanced',32,1024,10,21900);
insert into public.sweetie_accessories(accessory,name,stock,price) values
('monitor','Monitor de 24″',125,1850),('keyboard','Teclado externo',145,350),
('mouse','Mouse',145,200),('headset','Diadema USB',100,690);
