import { defineConfig, devices } from "@playwright/test";
import { createArgosReporterOptions } from "@argos-ci/playwright/reporter";

export default defineConfig({
    testDir: "./tests",
    outputDir: "./test-results",
    timeout: 60_000,
    expect: {
        timeout: 10_000,
    },
    // One browser at a time: the game renders in SwiftShader on the CPU, and parallel workers
    // starve each other into timeouts. CI splits the suite across machines with --shard instead;
    // fullyParallel lets it split by test rather than by file, so dungeons.spec.ts is spread out.
    fullyParallel: true,
    workers: 1,
    reporter: [
        // "github" turns failures into annotations on the pull request.
        ...(process.env.CI ? [["github"], ["dot"]] as const : [["list"]] as const),
        ["html", { open: "never", outputFolder: "playwright-report" }],
        [
            "@argos-ci/playwright/reporter",
            createArgosReporterOptions({ uploadToArgos: !!process.env.CI }),
        ],
    ],
    use: {
        baseURL: "http://127.0.0.1:4173",
        screenshot: "only-on-failure",
        trace: "retain-on-failure",
        launchOptions: {
            args: [
                "--enable-webgl",
                "--use-gl=angle",
                "--use-angle=swiftshader",
                "--disable-gpu-sandbox",
                "--disable-lcd-text",
                "--font-render-hinting=none",
            ],
        },
    },
    projects: [{
        name: "chromium",
        use: { ...devices["Desktop Chrome"], viewport: { width: 640, height: 640 } },
    }],
    webServer: {
        command: "npm run dev -- --host 127.0.0.1 --port 4173",
        url: "http://127.0.0.1:4173/tests/fixtures/npc-animation.html",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
});
