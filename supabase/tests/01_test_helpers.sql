-- Shared test helpers. Applied outside a transaction so they survive the
-- rollback each test file ends with.
create schema if not exists tests;
grant usage on schema tests to authenticated, anon;

create or replace function tests.assert(condition boolean, description text)
returns void language plpgsql as $$
begin
  if condition then
    raise notice '  PASS  %', description;
  else
    raise exception 'FAIL  %', description;
  end if;
end;
$$;
grant execute on function tests.assert(boolean, text) to authenticated, anon;

-- Act as a given user for subsequent statements.
create or replace function tests.login_as(user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', user_id::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
grant execute on function tests.login_as(uuid) to authenticated, anon;

-- Drop back to the owning role for fixture setup that RLS would otherwise block.
create or replace function tests.as_service()
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;
grant execute on function tests.as_service() to authenticated, anon;
