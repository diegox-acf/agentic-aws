import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // No HTML report: its JS files under coverage/ would be picked up by ESLint.
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      // index.ts files only wire real AWS clients into the handlers; `pnpm build` and the
      // deployed smoke tests cover them.
      exclude: ["src/**/*.test.ts", "src/**/index.ts"],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
