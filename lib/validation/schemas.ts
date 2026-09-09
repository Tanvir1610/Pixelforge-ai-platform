import { z } from "zod";

/**
 * Every server action validates its input through one of these. A schema is the
 * only accepted way to turn a FormData/JSON payload into typed values — nothing
 * downstream should be doing `as` casts on user input.
 */
export const frameworkSchema = z.enum(["nextjs", "react", "vue", "html"]);
export const stylingSchema = z.enum(["tailwind", "css_modules", "vanilla_css"]);
export const hostProviderSchema = z.enum(["none", "vercel", "netlify", "cloudflare"]);

export const slugSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Use lowercase letters, numbers and hyphens.");

export const emailSchema = z.string().trim().min(1, "Enter your email address.").email("Enter a valid email address.");

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .regex(/[0-9!@#$%^&*(),.?":{}|<>_-]/, "Include a number or symbol.");

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
});

export const signUpSchema = z.object({
  fullName: z.string().trim().min(1, "Enter your name.").max(80),
  email: emailSchema,
  password: passwordSchema,
});

export const resetPasswordSchema = z.object({ email: emailSchema });

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Give the project a name.").max(120),
  framework: frameworkSchema.default("nextjs"),
  styling: stylingSchema.default("tailwind"),
  typescript: z.boolean().default(true),
  responsive: z.boolean().default(true),
  hostProvider: hostProviderSchema.default("none"),
});

export const updateProjectSchema = createProjectSchema.partial().extend({
  projectId: z.string().uuid(),
  description: z.string().max(500).nullish(),
});

export const figmaUrlSchema = z
  .string()
  .trim()
  .url("Enter a full URL.")
  .refine(
    (value) => /^https:\/\/(www\.)?figma\.com\/(design|file)\/[A-Za-z0-9]+/.test(value),
    "That doesn't look like a Figma file URL. It should start with figma.com/design/.",
  );

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;

/** Turns a Zod error into the `{ field: message }` shape the forms render. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !result[key]) result[key] = issue.message;
  }
  return result;
}

/** Derives a URL-safe slug from a display name, with a short random suffix. */
export function toSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const stem = base.length >= 1 ? base : "project";
  return `${stem}-${Math.random().toString(36).slice(2, 6)}`;
}
