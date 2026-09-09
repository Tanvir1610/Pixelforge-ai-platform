"use client";

import * as React from "react";
import type { TaskState } from "@/types";

export interface SequenceItem {
  id: string;
  label: string;
  state: TaskState;
  result?: string;
}

/**
 * Advances a list of tasks one at a time so progress reflects real work
 * finishing rather than an animation that loops forever. Returns the list plus
 * a derived percentage and a done flag the UI can branch on.
 */
export function useSequence(initial: SequenceItem[], intervalMs = 1400, autoStart = true) {
  const [items, setItems] = React.useState(initial);
  const [running, setRunning] = React.useState(autoStart);

  React.useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setItems((current) => {
        const activeIndex = current.findIndex((item) => item.state === "active");
        const nextIndex = current.findIndex((item) => item.state === "pending");
        if (activeIndex === -1 && nextIndex === -1) {
          window.clearInterval(timer);
          return current;
        }
        return current.map((item, index) => {
          if (index === activeIndex) return { ...item, state: "done" as TaskState };
          if (index === nextIndex && activeIndex !== -1) return { ...item, state: "active" as TaskState };
          if (activeIndex === -1 && index === nextIndex) return { ...item, state: "active" as TaskState };
          return item;
        });
      });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [running, intervalMs]);

  const done = items.filter((item) => item.state === "done").length;
  const percent = Math.round((done / items.length) * 100);
  const complete = done === items.length;

  const reset = React.useCallback(() => {
    setItems(initial);
    setRunning(true);
  }, [initial]);

  return { items, percent, complete, running, setRunning, reset };
}
