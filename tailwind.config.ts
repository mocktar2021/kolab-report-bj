import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";
import animate from "tailwindcss-animate";

// Shadows use the ink color (#09090B) at low opacity, layered so they read as
// soft depth instead of a dark halo.
const ink = (alpha: number) => `rgb(9 9 11 / ${alpha})`;

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        // Section workflow states (Story 5.2)
        status: {
          "not-started": "hsl(var(--status-not-started))",
          "in-progress": "hsl(var(--status-in-progress))",
          completed: "hsl(var(--status-completed))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      // Type scale. Headings use tight leading and -0.02em tracking; body text
      // never goes below 15px. Register new names in src/lib/utils.ts too.
      fontSize: {
        display: [
          "clamp(2.5rem, 1.5rem + 3.4vw, 4rem)",
          { lineHeight: "1.05", letterSpacing: "-0.02em", fontWeight: "600" },
        ],
        h1: [
          "clamp(2rem, 1.4rem + 2vw, 3rem)",
          { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "600" },
        ],
        h2: [
          "clamp(1.5rem, 1.25rem + 0.9vw, 1.875rem)",
          { lineHeight: "1.2", letterSpacing: "-0.02em", fontWeight: "600" },
        ],
        h3: ["1.125rem", { lineHeight: "1.4", letterSpacing: "-0.01em", fontWeight: "500" }],
        lead: ["1.125rem", { lineHeight: "1.6", fontWeight: "400" }],
        body: ["1rem", { lineHeight: "1.6", fontWeight: "400" }],
        small: ["0.9375rem", { lineHeight: "1.5", fontWeight: "400" }],
      },
      boxShadow: {
        sm: `0 1px 2px 0 ${ink(0.04)}`,
        DEFAULT: `0 1px 2px 0 ${ink(0.04)}, 0 1px 3px 0 ${ink(0.04)}`,
        md: `0 2px 4px -1px ${ink(0.04)}, 0 4px 12px -2px ${ink(0.06)}`,
        lg: `0 4px 8px -2px ${ink(0.04)}, 0 12px 24px -6px ${ink(0.08)}`,
        xl: `0 8px 16px -4px ${ink(0.05)}, 0 24px 48px -12px ${ink(0.12)}`,
        float: [
          `0 1px 1px ${ink(0.02)}`,
          `0 2px 4px ${ink(0.03)}`,
          `0 8px 16px ${ink(0.04)}`,
          `0 24px 48px -8px ${ink(0.1)}`,
          `0 48px 96px -24px ${ink(0.18)}`,
        ].join(", "),
        glow: "0 0 0 1px hsl(var(--primary) / 0.25), 0 0 18px -2px hsl(var(--primary) / 0.45)",
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      keyframes: {
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        // Landing page micro-animations. Each loop holds its end state for
        // most of the cycle so the motion stays in the background.
        "assign-drop": {
          "0%, 12%": { opacity: "0", transform: "translateY(-14px) scale(0.85)" },
          "24%, 84%": { opacity: "1", transform: "translateY(0) scale(1)" },
          "96%, 100%": { opacity: "0", transform: "translateY(0) scale(1)" },
        },
        "fade-out-hold": {
          "0%, 12%": { opacity: "1" },
          "24%, 84%": { opacity: "0" },
          "96%, 100%": { opacity: "1" },
        },
        "fade-in-hold": {
          "0%, 12%": { opacity: "0" },
          "24%, 84%": { opacity: "1" },
          "96%, 100%": { opacity: "0" },
        },
        "grow-x": {
          "0%": { transform: "scaleX(0)" },
          "30%, 86%": { transform: "scaleX(1)", opacity: "1" },
          "100%": { transform: "scaleX(1)", opacity: "0" },
        },
        "progress-step": {
          "0%, 12%": { transform: "scaleX(0.6)" },
          "24%, 84%": { transform: "scaleX(0.8)" },
          "96%, 100%": { transform: "scaleX(0.6)" },
        },
        upload: {
          "0%": { transform: "scaleX(0.05)" },
          "70%, 100%": { transform: "scaleX(1)" },
        },
        ripple: {
          "0%": { transform: "scale(0.6)", opacity: "0.45" },
          "100%": { transform: "scale(1.9)", opacity: "0" },
        },
        caret: {
          "0%, 49%": { opacity: "1" },
          "50%, 100%": { opacity: "0" },
        },
      },
      animation: {
        shimmer: "shimmer 1.8s ease-in-out infinite",
        "accordion-down": "accordion-down 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
        "accordion-up": "accordion-up 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        float: "float 7s ease-in-out infinite",
        "assign-drop": "assign-drop 5s cubic-bezier(0.16, 1, 0.3, 1) infinite",
        "fade-out-hold": "fade-out-hold 5s ease-out infinite",
        "fade-in-hold": "fade-in-hold 5s ease-out infinite",
        "grow-x": "grow-x 6s cubic-bezier(0.16, 1, 0.3, 1) infinite",
        "progress-step": "progress-step 5s cubic-bezier(0.16, 1, 0.3, 1) infinite",
        upload: "upload 3.2s cubic-bezier(0.65, 0, 0.35, 1) infinite",
        ripple: "ripple 2.8s cubic-bezier(0, 0, 0.2, 1) infinite",
        caret: "caret 1s steps(1) infinite",
      },
    },
  },
  plugins: [
    animate,
    // sidebar-collapsed:* applies while <html data-sidebar="collapsed"> is set.
    // The attribute is written before first paint, so the app shell renders
    // at the right width without waiting for React.
    plugin(({ addVariant }) => {
      addVariant("sidebar-collapsed", ':root[data-sidebar="collapsed"] &');
    }),
  ],
};

export default config;
