import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      // No HTML report: its JS files under coverage/ would be picked up by ESLint.
      reporter: ["text", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      // Layouts and thin page shells are covered by `pnpm build` and the browser checks.
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/app/layout.tsx",
        "src/app/not-found.tsx",
        "src/app/**/page.tsx",
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
