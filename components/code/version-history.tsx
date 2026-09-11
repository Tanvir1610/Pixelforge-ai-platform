"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { History, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { restoreVersionAction, type RestoreState } from "@/lib/actions/versions";
import type { VersionSummary } from "@/lib/repositories/code";

/**
 * Version history.
 *
 * Every generation step writes a version and carries the untouched files
 * forward, so this list is a real timeline of the project rather than a log.
 * None of it was reachable: `listVersions` and `restoreVersion` both existed
 * and no screen called either, which made every generation effectively final.
 *
 * Restore is additive — the old file set is copied forward as a new version —
 * so it needs no confirmation and is undone by restoring the other way.
 */
const INITIAL: RestoreState = {};

export function VersionHistory({ versions }: { versions: VersionSummary[] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(restoreVersionAction, INITIAL);
  const [restoring, setRestoring] = React.useState<string | null>(null);

  // A restore changes which version the rest of the screen is showing, so the
  // page has to re-read once the answer arrives. An effect is the right place:
  // this synchronises with the router, an external system, and sets no state of
  // its own.
  React.useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, state.message, router]);

  if (versions.length === 0) {
    return (
      <p className="text-caption text-content-muted">
        No versions yet. Each generation step writes one.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {state.message && <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner>}

      <ol className="flex flex-col">
        {versions.map((version, index) => (
          <li key={version.id} className="flex items-center gap-3 border-b border-border py-2.5 last:border-b-0">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-sm bg-bg-subtle text-caption font-medium">
              {version.versionNumber}
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-body-sm font-medium">
                {version.label ?? `Version ${version.versionNumber}`}
                {index === 0 && <Badge tone="success" dot className="ml-2">Current</Badge>}
              </p>
              <p className="truncate text-caption text-content-muted">
                {version.fileCount} files
                {version.addedCount > 0 && ` · +${version.addedCount}`}
                {version.modifiedCount > 0 && ` · ~${version.modifiedCount}`}
                {version.deletedCount > 0 && ` · −${version.deletedCount}`}
                {" · "}
                <time dateTime={version.createdAt}>
                  {new Date(version.createdAt).toLocaleString("en-GB", {
                    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                  })}
                </time>
              </p>
            </div>

            {index > 0 && (
              <form action={action} onSubmit={() => setRestoring(version.id)}>
                <input type="hidden" name="versionId" value={version.id} />
                <Button
                  type="submit"
                  variant="secondary"
                  size="xs"
                  loading={pending && restoring === version.id}
                  title="Copy this file set forward as a new version"
                >
                  <RotateCcw />
                  Restore
                </Button>
              </form>
            )}
          </li>
        ))}
      </ol>

      <p className="flex items-center gap-1.5 text-caption text-content-muted">
        <History aria-hidden className="h-3.5 w-3.5" />
        Restoring copies a file set forward. Nothing is ever overwritten or deleted.
      </p>
    </div>
  );
}
