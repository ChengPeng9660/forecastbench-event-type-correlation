import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_ACTIONS ? "/forecastbench-event-type-correlation/" : "/",
  test: {
    environment: "jsdom",
    setupFiles: "./tests/setup.ts",
    include: ["tests/*.test.ts"],
    css: true,
  },
});
