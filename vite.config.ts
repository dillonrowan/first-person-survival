import { defineConfig } from "vitest/config";

export default defineConfig({
    worker: {
        format: "es",
    },
    build: {
        target: "es2022",
        // three.js alone is ~500 kB minified; the game code is a few kB on top.
        chunkSizeWarningLimit: 800,
    },
    test: {
        environment: "node",
        include: ["src/**/*.test.ts", "tools/**/*.test.ts"],
    },
});
