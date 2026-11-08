import { defineConfig, devices } from "@playwright/test";
import { createArgosReporterOptions } from "@argos-ci/playwright/reporter";

export default defineConfig({
    testDir: "./tests",
    outputDir: "./test-results",
    timeout: 60_000,
    expect: {
        timeout: 10_000,
    },
    fullyParallel: false,
    reporter: [
        [process.env.CI ? "dot" : "list"],
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
        url: "http://127.0.0.1:4173/npc-animation-test.html",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
});
