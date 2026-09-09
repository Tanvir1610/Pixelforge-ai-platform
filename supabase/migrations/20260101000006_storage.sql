-- =============================================================================
-- 0006 · Storage buckets and object-level policies
--
-- Every bucket is private. Clients receive short-lived signed URLs; objects are
-- never public. Paths are always `{project_id}/…` so the policy can resolve the
-- owning project from the first path segment.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('figma-assets',     'figma-assets',     false, 52428800,  null),
  ('project-assets',   'project-assets',   false, 52428800,  null),
  ('generated-assets', 'generated-assets', false, 52428800,  null),
  ('screenshots',      'screenshots',      false, 20971520,  array['image/png','image/jpeg','image/webp']),
  ('build-artifacts',  'build-artifacts',  false, 209715200, null),
  ('avatars',          'avatars',          false, 2097152,   array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

create or replace function public.project_id_from_path(object_name text)
returns uuid
language plpgsql
immutable
as $$
begin
  return (split_part(object_name, '/', 1))::uuid;
exception when others then
  return null;   -- malformed path: deny rather than error
end;
$$;

do $$
declare
  b text;
  project_buckets text[] := array[
    'figma-assets','project-assets','generated-assets','screenshots','build-artifacts'
  ];
begin
  foreach b in array project_buckets loop
    execute format($f$
      create policy "read %1$s" on storage.objects for select
        using (bucket_id = %1$L
               and public.can_read_project(public.project_id_from_path(name)));
    $f$, b);
    execute format($f$
      create policy "write %1$s" on storage.objects for insert
        with check (bucket_id = %1$L
                    and public.can_write_project(public.project_id_from_path(name)));
    $f$, b);
    execute format($f$
      create policy "delete %1$s" on storage.objects for delete
        using (bucket_id = %1$L
               and public.can_write_project(public.project_id_from_path(name)));
    $f$, b);
  end loop;
end $$;

-- Avatars are keyed by user id rather than project id.
create policy "read own avatar" on storage.objects for select
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "write own avatar" on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
