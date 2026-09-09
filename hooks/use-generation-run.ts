"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import type { GenerationRunRow, GenerationStepRow } from "@/lib/db/database.types";

/**
 * Subscribes to a generation run over Supabase Realtime.
 *
 * Pushed updates rather than polling (§30). The initial rows are fetched once
 * so the screen paints immediately, then the channel keeps them current. If the
 * subscription never establishes, a slow poll takes over — a stalled progress
 * bar is a worse failure than a few extra queries.
 */
export interface RunState {
  run: GenerationRunRow | null;
  steps: GenerationStepRow[];
  connected: boolean;
}

export function useGenerationRun(runId: string | null, initial?: { run: GenerationRunRow; steps: GenerationStepRow[] }) {
  const [state, setState] = React.useState<RunState>({
    run: initial?.run ?? null,
    steps: initial?.steps ?? [],
    connected: false,
  });

  React.useEffect(() => {
    if (!runId) return;
    const supabase = createClient();
    if (!supabase) return;

    let cancelled = false;

    async function load() {
      const [run, steps] = await Promise.all([
        supabase!.from("generation_runs").select("*").eq("id", runId!).maybeSingle(),
        supabase!.from("generation_steps").select("*").eq("generation_run_id", runId!).order("order_index"),
      ]);
      if (cancelled) return;
      setState((current) => ({
        ...current,
        run: run.data ?? current.run,
        steps: steps.data ?? current.steps,
      }));
    }

    void load();

    const channel = supabase
      .channel(`run:${runId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "generation_runs", filter: `id=eq.${runId}` },
        (payload) => setState((current) => ({ ...current, run: payload.new as GenerationRunRow })),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "generation_steps", filter: `generation_run_id=eq.${runId}` },
        (payload) => {
          const updated = payload.new as GenerationStepRow;
          setState((current) => ({
            ...current,
            steps: current.steps.some((step) => step.id === updated.id)
              ? current.steps.map((step) => (step.id === updated.id ? updated : step))
              : [...current.steps, updated].sort((a, b) => a.order_index - b.order_index),
          }));
        },
      )
      .subscribe((status) => {
        if (!cancelled) setState((current) => ({ ...current, connected: status === "SUBSCRIBED" }));
      });

    // Fallback poll. Cheap, and only meaningful while the run is unfinished.
    const poll = window.setInterval(() => {
      setState((current) => {
        const finished = current.run && ["completed", "failed", "cancelled"].includes(current.run.status);
        if (!current.connected && !finished) void load();
        return current;
      });
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [runId]);

  const done = state.steps.filter((step) => step.status === "completed").length;
  const percent = state.run?.progress ?? (state.steps.length ? Math.round((done / state.steps.length) * 100) : 0);
  const complete = state.run?.status === "completed";
  const failed = state.run?.status === "failed";

  return { ...state, percent, complete, failed };
}
