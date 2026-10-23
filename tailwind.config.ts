import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";
import animate from "tailwindcss-animate";

// Shadow color and strength come from the theme (globals.css): ink at low
// opacity on the light theme, black at three times the opacity on the dark
// one, where a faint shadow would not show.
const shade = (alpha: number) => `rgb(var(--shadow-rgb) / calc(${alpha} * var(--shadow-strength)))`;

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
        // The one brand accent (coral): focus rings, active filters and
        // navigation, progress strokes, small badges. Never a button fill.
        highlight: {
          DEFAULT: "hsl(var(--highlight))",
          foreground: "hsl(var(--highlight-foreground))",
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
        display: ["var(--font-display)", "var(--font-sans)", "system-ui", "sans-serif"],
      },
      // Type scale. Headings use Instrument Sans (font-display, set on h1 to
      // h3 in globals.css) at weight 500 with tight tracking; body text is
      // Inter Tight and never goes below 15px. Register new names in
      // src/lib/utils.ts too.
      fontSize: {
        display: [
          "clamp(2.5rem, 1.6rem + 3.1vw, 4.5rem)",
          { lineHeight: "1.02", letterSpacing: "-0.035em", fontWeight: "500" },
        ],
        h1: [
          "clamp(2rem, 1.45rem + 2.1vw, 3rem)",
          { lineHeight: "1.06", letterSpacing: "-0.03em", fontWeight: "500" },
        ],
        h2: [
          "clamp(1.625rem, 1.3rem + 1.1vw, 2.25rem)",
          { lineHeight: "1.12", letterSpacing: "-0.025em", fontWeight: "500" },
        ],
        h3: ["1.1875rem", { lineHeight: "1.35", letterSpacing: "-0.015em", fontWeight: "500" }],
        lead: ["clamp(1rem, 0.95rem + 0.25vw, 1.125rem)", { lineHeight: "1.6", fontWeight: "400" }],
        body: ["1rem", { lineHeight: "1.6", fontWeight: "400" }],
        small: ["0.9375rem", { lineHeight: "1.55", fontWeight: "400" }],
      },
      boxShadow: {
        sm: `0 1px 2px 0 ${shade(0.04)}`,
        DEFAULT: `0 1px 2px 0 ${shade(0.04)}, 0 1px 3px 0 ${shade(0.04)}`,
        md: `0 2px 4px -1px ${shade(0.04)}, 0 4px 12px -2px ${shade(0.06)}`,
        lg: `0 4px 8px -2px ${shade(0.04)}, 0 12px 24px -6px ${shade(0.08)}`,
        xl: `0 8px 16px -4px ${shade(0.05)}, 0 24px 48px -12px ${shade(0.12)}`,
        float: [
          `0 1px 1px ${shade(0.02)}`,
          `0 2px 4px ${shade(0.03)}`,
          `0 8px 16px ${shade(0.04)}`,
          `0 24px 48px -8px ${shade(0.1)}`,
          `0 48px 96px -24px ${shade(0.18)}`,
        ].join(", "),
        glow: "0 0 0 1px hsl(var(--highlight) / 0.25), 0 0 18px -2px hsl(var(--highlight) / 0.45)",
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
        // Slow drift of the landing illustration cards.
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
      },
      animation: {
        shimmer: "shimmer 1.8s ease-in-out infinite",
        "accordion-down": "accordion-down 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
        "accordion-up": "accordion-up 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        float: "float 9s ease-in-out infinite",
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
    // launched:* and prelaunch:* follow <html data-launched>, set by the
    // hero's inline script once the launch has passed (KRB-239).
    plugin(({ addVariant }) => {
      addVariant("launched", ":root[data-launched] &");
      addVariant("prelaunch", ":root:not([data-launched]) &");
    }),
  ],
};

export default config;
