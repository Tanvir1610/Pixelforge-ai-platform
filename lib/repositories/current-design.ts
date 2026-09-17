import "server-only";

import type { Client } from "@/lib/supabase/server";

/**
 * The design a project is currently built from.
 *
 * A project can have been imported more than once, from different files.
 * Re-importing replaced the layers — design nodes and tokens are cleared
 * project-wide — but left the previous file's pages and frames in place,
 * because those hang off the file row and only a re-import of the *same* file
 * replaced them.
 *
 * Every reader then asked for "the project's frames, widest first", and got a
 * mix of files. In practice: a project re-imported from a single 1440px page
 * went on showing — in Preview, Responsive and Design, and in what code
 * generation was about to be shown — a component sheet from an import a week
 * earlier, because its frames happened to be wider.
 *
 * Imports now remove the files they supersede. This scopes every read to the
 * latest one regardless, so projects imported before that fix read correctly
 * without being imported again.
 */
export interface CurrentDesign {
  fileId: string;
  fileKey: string;
  /** Frames are reached through pages; filter frames by these. */
  pageIds: string[];
}

export async function currentDesign(supabase: Client, projectId: string): Promise<CurrentDesign | null> {
  const { data: file } = await supabase
    .from("figma_files")
    .select("id, figma_file_key")
    .eq("project_id", projectId)
    .order("last_imported_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle<{ id: string; figma_file_key: string }>();

  if (!file) return null;

  const { data: pages } = await supabase
    .from("figma_pages")
    .select("id")
    .eq("figma_file_id", file.id)
    .overrideTypes<{ id: string }[]>();

  return { fileId: file.id, fileKey: file.figma_file_key, pageIds: (pages ?? []).map((page) => page.id) };
}
