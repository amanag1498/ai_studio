import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#081018",
        mist: "#eef5f1",
        lime: "#b6ff87",
        sand: "#e7cf9d",
        coral: "#ff8f70",
      },
      boxShadow: {
        panel: "0 18px 60px rgba(8, 16, 24, 0.14)",
      },
      fontFamily: {
        sans: ["'Space Grotesk'", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
