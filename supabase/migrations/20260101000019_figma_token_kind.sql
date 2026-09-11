-- =============================================================================
-- 0019 · How a Figma connection was obtained
--
-- OAuth is not the only way a user can connect, and on this deployment it is
-- not yet a working one: a Figma OAuth app published as Private is visible only
-- to the organization that owns it, so every other account is told the app does
-- not exist. Making it visible to anyone means a Public app and Figma's review.
--
-- A personal access token needs none of that. The user creates one in their own
-- Figma settings and pastes it; it authorises exactly the files that account can
-- already open, which is the same boundary OAuth would have given us.
--
-- The two are not interchangeable at the wire, though — OAuth sends
-- `Authorization: Bearer`, a personal token sends `X-Figma-Token` — so which
-- one a row holds has to be recorded rather than guessed. It was previously
-- assumed to be OAuth, and a pasted token would have been sent with the wrong
-- header and rejected as unauthorised.
-- =============================================================================

alter table public.figma_connections
  add column if not exists token_kind text not null default 'oauth'
    check (token_kind in ('oauth', 'personal'));

-- Safe to run more than once: the column add is conditional, and the function
-- is dropped before it is created.
comment on column public.figma_connections.token_kind is
  'oauth = bearer token from the connect flow; personal = a user-supplied Figma personal access token.';

-- A personal token does not expire and has no refresh token, so the existing
-- "is it still live" test has to stop treating a null expiry as suspicious.
--
-- Dropped first, not replaced. `create or replace` cannot change a function's
-- return type, and adding token_kind to the returned table changes it:
--   ERROR: cannot change return type of existing function
-- Nothing in SQL depends on this function — only the application calls it — so
-- dropping it is safe. The grant goes with it, and is reinstated below.
drop function if exists public.my_figma_connection();

create function public.my_figma_connection()
returns table (figma_handle text, expires_at timestamptz, is_active boolean, token_kind text)
language sql
stable
security definer
set search_path = public
as $my_figma_connection$
  select
    c.figma_handle,
    c.expires_at,
    (c.revoked_at is null and (c.expires_at is null or c.expires_at > now())),
    c.token_kind
  from public.figma_connections c
  where c.user_id = auth.uid()
    and public.is_org_member(c.organization_id)
  limit 1;
$my_figma_connection$;

grant execute on function public.my_figma_connection() to authenticated;
