import type { Config } from "tailwindcss";

/**
 * Design tokens extracted from the PixelForge AI Figma file.
 * Every value here maps to a named variable in the design system page —
 * no arbitrary values should be introduced in components.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "var(--bg-primary)",
          surface: "var(--bg-surface)",
          subtle: "var(--bg-subtle)",
          dark: "var(--bg-dark)",
          "dark-2": "var(--bg-dark-2)",
          "dark-3": "var(--bg-dark-3)",
        },
        accent: {
          DEFAULT: "var(--accent-primary)",
          secondary: "var(--accent-secondary)",
          soft: "var(--accent-soft)",
          hover: "var(--accent-hover)",
        },
        success: { DEFAULT: "var(--success)", soft: "var(--success-soft)", text: "var(--success-text)" },
        warning: { DEFAULT: "var(--warning)", soft: "var(--warning-soft)", text: "var(--warning-text)" },
        error: { DEFAULT: "var(--error)", soft: "var(--error-soft)", text: "var(--error-text)" },
        border: { DEFAULT: "var(--border-default)", strong: "var(--border-strong)", dark: "var(--border-dark)" },
        content: {
          DEFAULT: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
          inverse: "var(--text-inverse)",
          "on-dark": "var(--text-on-dark-muted)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        display: ["64px", { lineHeight: "1.05", letterSpacing: "-0.03em", fontWeight: "800" }],
        "display-sm": ["44px", { lineHeight: "1.08", letterSpacing: "-0.03em", fontWeight: "800" }],
        h1: ["40px", { lineHeight: "1.15", letterSpacing: "-0.025em", fontWeight: "700" }],
        h2: ["28px", { lineHeight: "1.2", letterSpacing: "-0.02em", fontWeight: "700" }],
        h3: ["18px", { lineHeight: "1.35", letterSpacing: "-0.01em", fontWeight: "600" }],
        "body-lg": ["17px", { lineHeight: "1.6" }],
        body: ["14px", { lineHeight: "1.55" }],
        "body-sm": ["13px", { lineHeight: "1.5" }],
        caption: ["12px", { lineHeight: "1.4" }],
        code: ["13px", { lineHeight: "1.6" }],
      },
      borderRadius: { sm: "6px", md: "8px", lg: "12px", xl: "16px", "2xl": "24px" },
      spacing: {
        "1": "4px", "2": "8px", "3": "12px", "4": "16px", "5": "20px", "6": "24px",
        "8": "32px", "10": "40px", "12": "48px", "16": "64px", "20": "80px", "24": "96px", "30": "120px",
      },
      boxShadow: {
        sm: "0 1px 2px rgba(17,17,17,.04)",
        md: "0 4px 12px -2px rgba(17,17,17,.08), 0 1px 2px rgba(17,17,17,.04)",
        lg: "0 20px 40px -12px rgba(17,17,17,.14), 0 2px 6px rgba(17,17,17,.04)",
        focus: "0 0 0 3px rgba(99,102,241,.35)",
      },
      maxWidth: { container: "1440px", prose: "52ch" },
      zIndex: { dropdown: "40", sticky: "50", overlay: "60", modal: "70", toast: "80" },
      keyframes: {
        spin: { to: { transform: "rotate(360deg)" } },
        shimmer: { "0%": { backgroundPosition: "200% 0" }, "100%": { backgroundPosition: "-200% 0" } },
        pulseRing: {
          "0%": { boxShadow: "0 0 0 0 rgba(99,102,241,.45)" },
          "70%": { boxShadow: "0 0 0 8px rgba(99,102,241,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(99,102,241,0)" },
        },
        scan: { "0%": { top: "8%" }, "100%": { top: "82%" } },
        fadeUp: { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: {
        shimmer: "shimmer 1.4s infinite",
        "pulse-ring": "pulseRing 1.8s infinite",
        scan: "scan 2.6s ease-in-out infinite alternate",
        "fade-up": "fadeUp .18s ease-out",
      },
      screens: { sm: "390px", md: "768px", lg: "1280px", xl: "1440px" },
    },
  },
  plugins: [],
};

export default config;
