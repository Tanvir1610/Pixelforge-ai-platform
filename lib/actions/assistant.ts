"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { requireSession, type Session } from "@/lib/auth/session";
import { getDesignSummary } from "@/lib/repositories/design-read";
import { recordModelRun } from "@/lib/repositories/artifacts";
import { listProjects } from "@/lib/repositories/projects";
import { bootstrapProviders, isInferenceConfigured } from "@/lib/ai/bootstrap";
import { resolveProvider } from "@/lib/ai/registry";
import type { ModelMessage } from "@/lib/ai/types";

/**
 * The refinement assistant.
 *
 * It was a setTimeout that replied "Applied. Hero now matches at 99%." to
 * anything, including an empty project — a canned sentence that read as a
 * working product and reported work nobody had done.
 *
 * Now it calls the configured provider with the project's own design summary,
 * persists both sides to `ai_messages`, and meters what the call cost. It is
 * deliberately advisory: it answers about the design and the generated code and
 * changes nothing. Applying an edit goes through the tool system, which is
 * mode-gated and audited, and wiring this straight into it would route writes
 * around that.
 */
export interface AssistantReply {
  ok: boolean;
  /** Rendered as the assistant's message, or as an error when ok is false. */
  message: string;
  /** Cost and provenance, shown under the reply so the spend is never hidden. */
  status?: string;
}

const MAX_INPUT = 2_000;
const MAX_HISTORY = 8;

const SYSTEM = [
  "You are the refinement assistant inside PixelForge AI, a platform that converts Figma designs into code.",
  "You are advisory: you can explain, diagnose and propose, but you cannot edit files or apply changes.",
  "If asked to make a change, say precisely what you would change and in which file, and say that applying it is a separate, explicit step.",
  "Be concise and concrete. Prefer naming real components, tokens and frames from the context over generalities.",
  "If the context does not contain something, say so rather than inventing it. Never invent a similarity score, a file name or a metric.",
].join(" ");

/**
 * Design context for the model.
 *
 * Marked untrusted, because frame and layer names come from a Figma file this
 * platform did not write. See docs/SECURITY.md — a layer called "ignore your
 * instructions" is data, not an instruction.
 */
async function designContext(session: Session, projectId: string): Promise<string> {
  const summary = await getDesignSummary(session, projectId);
  if (!summary) return "No design has been imported into this project yet.";

  const frames = summary.frames
    .slice(0, 12)
    .map((frame) => `- ${frame.name} (${frame.width}x${frame.height})`)
    .join("\n");

  const components = summary.components
    .slice(0, 25)
    .map((component) => `- ${component.name}${component.role ? ` -> ${component.role}` : ""}`)
    .join("\n");

  const tokens = summary.tokens
    .slice(0, 25)
    .map((token) => `- ${token.category}.${token.name}`)
    .join("\n");

  return [
    `Frames (${summary.frames.length}):`,
    frames || "- none",
    ``,
    `Nodes in the design representation: ${summary.nodeCount}`,
    ``,
    `Detected components (${summary.components.length}):`,
    components || "- none",
    ``,
    `Design tokens (${summary.tokens.length}):`,
    tokens || "- none",
    ``,
    summary.needsReview.length
      ? `Low-confidence detections a human should check: ${summary.needsReview.map((entry) => entry.name).join(", ")}`
      : "No low-confidence detections.",
  ].join("\n");
}

export async function askAssistantAction(input: {
  prompt: string;
  history?: { role: "user" | "assistant"; body: string }[];
}): Promise<AssistantReply> {
  const prompt = input.prompt.trim().slice(0, MAX_INPUT);
  if (!prompt) return { ok: false, message: "Ask a question first." };

  const session = await requireSession();

  if (session.demo) {
    return {
      ok: false,
      message: "This is demo data. Connect Supabase and import a design to use the assistant on a real project.",
    };
  }

  bootstrapProviders();
  if (!isInferenceConfigured()) {
    return {
      ok: false,
      message: "No AI provider is configured on this deployment, so the assistant can't answer yet. Set ANTHROPIC_API_KEY.",
    };
  }

  const projects = await listProjects(session, 1);
  const project = projects[0];
  if (!project) {
    return { ok: false, message: "Create a project and import a design before asking about it." };
  }

  const supabase = createServiceClient();

  // Checked before the call rather than after, so nobody is charged for a run
  // that was never allowed to happen.
  const { data: hasCredits } = await supabase.rpc("has_credits", {
    p_organization_id: session.organization.id,
    p_needed: 1,
  });
  if (hasCredits === false) {
    return { ok: false, message: "You've used this month's AI credits. They reset at the start of next month." };
  }

  const context = await designContext(session, project.id);

  const messages: ModelMessage[] = [
    {
      role: "user",
      content: [{ type: "text", text: `Project: ${project.name}\n\n${context}` }],
      // Figma layer names are not ours; they must never read as instructions.
      untrusted: true,
    },
    ...(input.history ?? []).slice(-MAX_HISTORY).map((entry) => ({
      role: entry.role,
      content: [{ type: "text" as const, text: entry.body.slice(0, MAX_INPUT) }],
    })),
    { role: "user" as const, content: [{ type: "text" as const, text: prompt }] },
  ];

  // Persisted before the call, so a question is never lost to a provider error.
  await supabase.from("ai_messages").insert({
    project_id: project.id,
    role: "user",
    content: prompt,
    created_by: session.user.id,
  });

  try {
    const provider = resolveProvider("refinement");
    const result = await provider.generate({
      purpose: "refinement",
      system: SYSTEM,
      messages,
      maxOutputTokens: 1_000,
      temperature: 0.2,
      signal: AbortSignal.timeout(60_000),
    });

    await supabase.from("ai_messages").insert({
      project_id: project.id,
      role: "assistant",
      content: result.text,
    });

    // Every call is metered, including this one. An assistant that spent
    // credits without recording them would make cost reporting wrong.
    await recordModelRun({
      organizationId: session.organization.id,
      projectId: project.id,
      agent: "refinement_assistant",
      purpose: "refinement",
      modelKey: result.modelKey,
      providerKey: result.providerKey,
      usage: result.usage,
    });

    return {
      ok: true,
      message: result.text,
      status: `${result.modelKey} · ${result.usage.inputTokens + result.usage.outputTokens} tokens · ${Math.round(result.usage.latencyMs)}ms`,
    };
  } catch (error) {
    console.error("[assistant]", error);
    return { ok: false, message: "The model provider didn't respond. Try again in a moment." };
  }
}

/** Recent conversation for this project, so a reload does not lose the thread. */
export async function loadAssistantHistory(): Promise<{ role: "user" | "assistant"; body: string }[]> {
  const session = await requireSession();
  if (session.demo) return [];

  const projects = await listProjects(session, 1);
  const project = projects[0];
  if (!project) return [];

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("ai_messages")
    .select("role, content, created_at")
    .eq("project_id", project.id)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: false })
    .limit(20)
    .overrideTypes<{ role: string; content: string; created_at: string }[]>();

  return (data ?? [])
    .reverse()
    .map((row) => ({ role: row.role === "user" ? ("user" as const) : ("assistant" as const), body: row.content }));
}
