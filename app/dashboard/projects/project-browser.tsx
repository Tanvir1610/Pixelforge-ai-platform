"use client";

import * as React from "react";
import { useActionState } from "react";
import { Pencil, Search, Trash2 } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { ProjectCard } from "@/components/sections/project-card";
import {
  deleteProjectAction, renameProjectAction, type ProjectMutationState,
} from "@/lib/actions/projects";
import type { ProjectRow } from "@/lib/db/database.types";

/**
 * Browsing, renaming and deleting projects.
 *
 * The list was read-only: a project could be created and never renamed,
 * deleted, searched or sorted. On a workspace with more than a handful that is
 * not a list, it is a pile.
 *
 * Filtering and sorting happen here rather than in a query, because the page
 * already loads the workspace's projects and a round trip per keystroke would
 * be slower and no more correct.
 */
type Sort = "updated" | "created" | "name";

const INITIAL: ProjectMutationState = {};

/** One opening of a dialog, tagged so its answer can be recognised. */
interface Request {
  project: ProjectRow;
  nonce: string;
}

function request(project: ProjectRow): Request {
  return { project, nonce: `${project.id}:${Date.now()}` };
}

const SORTS: { value: Sort; label: string }[] = [
  { value: "updated", label: "Last modified" },
  { value: "created", label: "Newest" },
  { value: "name", label: "Name" },
];

export function ProjectBrowser({ projects }: { projects: ProjectRow[] }) {
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<Sort>("updated");
  // Each opening carries a fresh nonce, which the action echoes back. The
  // dialog is then open exactly while the answer is for an older attempt, so
  // it closes itself on success without setting state from an effect — and
  // re-editing the same project still opens, because the nonce differs.
  const [renaming, setRenaming] = React.useState<Request | null>(null);
  const [deleting, setDeleting] = React.useState<Request | null>(null);

  const [renameState, renameAction, renamePending] = useActionState(renameProjectAction, INITIAL);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteProjectAction, INITIAL);

  const renameOpen = renaming !== null && !(renameState.ok && renameState.nonce === renaming.nonce);
  const deleteOpen = deleting !== null && !(deleteState.ok && deleteState.nonce === deleting.nonce);

  const visible = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? projects.filter(
          (project) =>
            project.name.toLowerCase().includes(needle) || project.slug.toLowerCase().includes(needle),
        )
      : projects;

    return [...matched].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      const key = sort === "created" ? "created_at" : "updated_at";
      return new Date(b[key]).getTime() - new Date(a[key]).getTime();
    });
  }, [projects, query, sort]);

  return (
    <>
      {(renameState.message || deleteState.message) && (
        <Banner
          tone={renameState.ok || deleteState.ok ? "success" : "error"}
          className="mb-5"
        >
          {renameState.message || deleteState.message}
        </Banner>
      )}

      {projects.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Input
            className="min-w-[200px] max-w-[320px] flex-1"
            icon={<Search />}
            aria-label="Search projects"
            placeholder="Search by name"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <label className="flex items-center gap-2 text-body-sm text-content-muted">
            Sort
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
              aria-label="Sort projects"
              className="h-11 rounded-md border border-border bg-bg-surface px-2.5 text-base text-content shadow-sm outline-none focus:border-accent sm:h-[38px] sm:text-body"
            >
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <span className="ml-auto text-body-sm text-content-muted">
            {visible.length} of {projects.length}
          </span>
        </div>
      )}

      {visible.length === 0 ? (
        query ? (
          <EmptyState
            icon={<Search />}
            title={`No projects match "${query}"`}
            body="Try a shorter term, or clear the search to see everything in this workspace."
            action={<Button variant="ghost" size="sm" onClick={() => setQuery("")}>Clear search</Button>}
          />
        ) : null
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((project) => (
            <div key={project.id} className="relative">
              <ProjectCard project={project} />
              {/* Overlaid rather than built into the card, so the card stays a
                  link and the controls stay reachable by keyboard. */}
              <div className="absolute right-2.5 top-2.5 z-20 flex gap-1">
                <button
                  type="button"
                  onClick={() => setRenaming(request(project))}
                  aria-label={`Rename ${project.name}`}
                  title="Rename"
                  className="grid h-7 w-7 place-items-center rounded-sm bg-bg-surface/90 text-content-muted shadow-sm backdrop-blur transition-colors hover:text-content"
                >
                  <Pencil aria-hidden className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleting(request(project))}
                  aria-label={`Delete ${project.name}`}
                  title="Delete"
                  className="grid h-7 w-7 place-items-center rounded-sm bg-bg-surface/90 text-content-muted shadow-sm backdrop-blur transition-colors hover:text-error-text"
                >
                  <Trash2 aria-hidden className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </ul>
      )}

      <Modal open={renameOpen} onClose={() => setRenaming(null)} title="Rename project">
        {renaming && (
          <form action={renameAction} className="flex flex-col gap-4 p-5">
            <input type="hidden" name="projectId" value={renaming.project.id} />
            <input type="hidden" name="nonce" value={renaming.nonce} />
            <Field label="Project name" htmlFor="rename-name" error={renameState.errors?.name}>
              <Input id="rename-name" name="name" defaultValue={renaming.project.name} autoFocus required maxLength={120} />
            </Field>
            {/* The slug is what URLs and storage paths are built from, so it is
                not changed by a rename and the user should know that. */}
            <p className="text-caption text-content-muted">
              The project&apos;s address stays <code className="font-mono">{renaming.project.slug}</code> — links and
              stored files keep working.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setRenaming(null)}>Cancel</Button>
              <Button type="submit" variant="primary" loading={renamePending}>Rename</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={deleteOpen} onClose={() => setDeleting(null)} title="Delete project">
        {deleting && (
          <form action={deleteAction} className="flex flex-col gap-4 p-5">
            <input type="hidden" name="projectId" value={deleting.project.id} />
            <input type="hidden" name="nonce" value={deleting.nonce} />
            <input type="hidden" name="expected" value={deleting.project.name} />
            <Banner tone="warning">
              This removes <b className="font-semibold">{deleting.project.name}</b> from the workspace along with its
              imported design, generated versions and deployments.
            </Banner>
            <Field
              label={`Type "${deleting.project.name}" to confirm`}
              htmlFor="delete-confirm"
              help="Deliberate by design — this is the one action that throws work away."
            >
              <Input id="delete-confirm" name="confirm" autoFocus autoComplete="off" required />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button type="submit" variant="danger" loading={deletePending}>
                <Trash2 />
                Delete project
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
