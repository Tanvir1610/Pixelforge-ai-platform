"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Lock, Upload } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  connectFigmaAction, importFigmaFileAction, importImageAction, type ImportState,
} from "@/lib/actions/import";
import { cn } from "@/lib/utils";

// .fig is not here. Figma's format is proprietary and undocumented, so there is
// no parser to write against; listing it and failing quietly was worse than
// saying so, which the action does if one is dropped anyway.
const SUPPORTED = [".png", ".jpg", ".webp", ".svg"];

/** Reasons the Figma callback can send someone back here. */
const CONNECT_ERRORS: Record<string, string> = {
  declined: "The Figma connection was cancelled. Nothing changed.",
  missing_code: "Figma sent us back without an authorization code. Try connecting again.",
  invalid_state: "That connection link has expired or was already used. Start again from this page.",
  exchange_failed: "Figma rejected the connection. Try again, or paste a file URL instead.",
  not_configured: "Figma sign-in isn't set up on this deployment yet. Paste a file URL instead.",
  forbidden: "You need the developer role or higher to connect a Figma account.",
  begin_failed: "We couldn't start the Figma connection. Try again in a moment.",
};
const INITIAL: ImportState = {};

export function ImportOptions({
  projectId, figmaConnected, demo, connectError, justConnected,
}: {
  projectId: string | null;
  figmaConnected: boolean;
  demo: boolean;
  connectError?: string;
  justConnected?: boolean;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(importFigmaFileAction, INITIAL);
  const [uploadState, uploadAction, uploading] = useActionState(importImageAction, INITIAL);
  const uploadForm = React.useRef<HTMLFormElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);

  // A run id means the pipeline is live; the analysis screen subscribes to it.
  React.useEffect(() => {
    if (state.runId) router.push(`/dashboard/analysis?run=${state.runId}`);
  }, [state.runId, router]);

  // An upload produces a run of its own; the analysis screen subscribes to it
  // the same way. Only navigate on success — a failure has a message to read.
  React.useEffect(() => {
    if (uploadState.runId && !uploadState.message?.includes("could not")) {
      router.push(`/dashboard/analysis?run=${uploadState.runId}`);
    }
  }, [uploadState.runId, uploadState.message, router]);

  const blocked = demo || !projectId;

  return (
    <div className="flex flex-col gap-3">
      {demo && (
        <Banner tone="info">
          <b className="font-semibold">Demo data.</b> Connect Supabase to import a real Figma file.
        </Banner>
      )}
      {!demo && !projectId && (
        <Banner tone="warning">Create a project first — an import has to land somewhere.</Banner>
      )}
      {state.message && <Banner tone="error">{state.message}</Banner>}
      {justConnected && <Banner tone="success">Figma connected. You can import any file this account can open.</Banner>}
      {connectError && <Banner tone="error">{CONNECT_ERRORS[connectError] ?? CONNECT_ERRORS.begin_failed}</Banner>}

      <section className="flex flex-wrap items-center gap-[18px] rounded-[14px] border border-border bg-bg-surface px-6 py-[22px]">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] bg-bg-subtle">
          <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" className="h-5 w-5">
            <path d="M8 3h4v6H8a3 3 0 0 1 0-6zM12 3h4a3 3 0 0 1 0 6h-4V3zM8 9h4v6H8a3 3 0 0 1 0-6zM8 15h4v3a3 3 0 1 1-4-3zM12 12a3 3 0 1 1 6 0 3 3 0 0 1-6 0z" />
          </svg>
        </span>
        <div className="min-w-[200px] flex-1">
          <h2 className="text-[15px] font-semibold">Connect Figma</h2>
          <p className="text-body-sm text-content-muted">
            {figmaConnected
              ? "Connected. We can read any file your account can open."
              : "Browse your files and pick frames to convert. Best accuracy."}
          </p>
        </div>
        {/* A form posting to a server action. It was a bare <Button> with no
            onClick and no form — the table, the read path and the token column
            all existed, and clicking did nothing. */}
        <form action={connectFigmaAction}>
          <Button type="submit" variant={figmaConnected ? "secondary" : "primary"} disabled={demo}>
            {figmaConnected ? "Reconnect" : "Connect Figma"}
          </Button>
        </form>
      </section>

      <form action={formAction} className="flex flex-col gap-3.5 rounded-[14px] border border-border bg-bg-surface px-6 py-[22px]">
        <input type="hidden" name="projectId" value={projectId ?? ""} />
        <div className="flex items-center gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] bg-bg-subtle">
            <Link2 aria-hidden className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold">Paste a Figma URL</h2>
            <p className="text-body-sm text-content-muted">Works with any file you can view. Share access is enough.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            name="url"
            className="min-w-[240px] flex-1"
            icon={<Link2 />}
            aria-label="Figma file URL"
            placeholder="https://figma.com/design/8kQ2/Northwind?node-id=142-8"
            invalid={Boolean(state.errors?.url)}
            disabled={blocked}
          />
          <Button type="submit" variant="dark" loading={pending} disabled={blocked}>Import</Button>
        </div>
        {state.errors?.url && <p className="text-caption text-error-text">{state.errors.url}</p>}
        {pending && (
          <p className="text-caption text-content-muted">
            Reading the file and normalising it — this takes a few seconds for a large page.
          </p>
        )}
      </form>

      <form
        ref={uploadForm}
        action={uploadAction}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          // Dropped files are put into the real input, so drop and browse take
          // exactly the same path rather than two that can diverge.
          const dropped = event.dataTransfer.files;
          if (dropped.length && fileInput.current) {
            fileInput.current.files = dropped;
            uploadForm.current?.requestSubmit();
          }
        }}
        className={cn(
          "rounded-[14px] border-[1.5px] border-dashed bg-bg-surface p-8 text-center transition-colors md:p-11",
          dragging ? "border-accent bg-accent-soft" : "border-border-strong",
        )}
      >
        <input type="hidden" name="projectId" value={projectId ?? ""} />
        <span className="mx-auto mb-3.5 grid h-12 w-12 place-items-center rounded-lg bg-bg-subtle">
          <Upload aria-hidden className="h-[22px] w-[22px]" />
        </span>
        <h2 className="text-[15px] font-semibold">Drop a screenshot here</h2>
        <p className="mt-1 text-body-sm text-content-muted">
          Or{" "}
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={blocked || uploading}
            className="font-medium text-accent underline-offset-4 hover:underline disabled:text-content-muted disabled:no-underline"
          >
            browse your files
          </button>
          . A screenshot is read by a vision model, so it gives a rougher result than a Figma URL — every
          layer it finds is flagged for review.
        </p>
        <input
          ref={fileInput}
          name="file"
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.svg"
          disabled={blocked || uploading}
          onChange={(event) => {
            if (event.target.files?.length) uploadForm.current?.requestSubmit();
          }}
          className="sr-only"
        />
        {uploading && (
          <p className="mt-3 text-body-sm text-content-muted">
            Reading the screenshot — this takes a few seconds.
          </p>
        )}
        {uploadState.message && (
          <p className="mt-3 text-body-sm text-content-secondary">{uploadState.message}</p>
        )}
        <ul className="mt-4 flex justify-center gap-1.5">
          {SUPPORTED.map((type) => (
            <li key={type} className="rounded-[5px] border border-border bg-bg px-2 py-0.5 font-mono text-[11px] text-content-secondary">
              {type}
            </li>
          ))}
        </ul>
      </form>

      <p className="mt-3 flex items-center justify-center gap-2 text-body-sm text-content-muted">
        <Lock aria-hidden className="h-3.5 w-3.5" />
        Your designs remain private. Never used for training, deleted after export.
      </p>
    </div>
  );
}
