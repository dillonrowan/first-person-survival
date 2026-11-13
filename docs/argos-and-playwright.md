# Argos and Playwright

This project uses Playwright to test and capture deterministic NPC WebGL renders.
Argos stores visual baselines remotely and compares screenshots from pull-request builds.

## Test setup

[playwright.config.ts](../playwright.config.ts) contains the browser configuration.

- Tests live in [tests/](../tests/).
- The NPC visual fixture is [npc-animation.html](../tests/fixtures/npc-animation.html).
- Chromium runs in headless mode with SwiftShader WebGL.
- Text-rendering flags reduce differences between local machines and CI.
- The `list` or `dot` reporter controls terminal output.
- The HTML reporter writes to `playwright-report/`.
- Failed-test data writes to `test-results/`.
- Failure screenshots and traces are collected for Playwright debugging.
- Screenshots created without Argos are stored in `screenshots/`.

The Argos Playwright reporter uploads builds only when `CI` is set:

```ts
createArgosReporterOptions({ uploadToArgos: !!process.env.CI })
```

Local test runs do not upload to Argos. The CI-mode run uploads named screenshots and failure artifacts.

## Screenshot captures

[tests/npc-animation.spec.ts](../tests/npc-animation.spec.ts) uses
`argosScreenshot(page, name, options)` after selecting deterministic NPC state and waiting for a ready render.

Current screenshots:

- `npc-5241-idle-frame-0`
- `npc-5241-idle-frame-45`
- `npc-5241-walk-frame-4-front`
- `npc-6709-attack-frame-4-windup`
- `npc-6709-attack-frame-8-impact`

Each capture targets the 640 by 640 canvas. Capture names are stable and unique because Argos uses them to match screenshots between builds.

Tests retain Playwright canvas screenshot buffers for hash and size assertions. Argos uses those same deterministic visual states for remote baseline comparison.

## CI and pull requests

[.github/workflows/ci.yml](../.github/workflows/ci.yml) runs the visual job for pull requests targeting `main`.
The job installs Chromium and runs:

```bash
npm run test:e2e
```

The workflow provides the Argos project token as the `ARGOS_TOKEN` repository secret:

```yaml
env:
  ARGOS_TOKEN: ${{ secrets.ARGOS_TOKEN }}
```

Do not commit the token, put it in source files, or log it.

On pull requests:

1. GitHub Actions runs Playwright.
2. The Argos reporter uploads screenshot and failure data.
3. Argos compares the build with the approved remote baseline.
4. Argos reports visual changes through the pull-request check and build page.

Fork pull requests should not receive repository secrets. Run Argos only when the
workflow can safely access `ARGOS_TOKEN`.

## Baselines

Argos baselines are remote, not PNG files in Git. A first build may be marked as
orphaned until a default-branch build establishes the baseline.

Review visual changes in Argos:

- Approve intentional UI changes to update eligible baseline status.
- Reject unintended changes and fix the implementation or screenshot setup.
- Investigate rejected builds for nondeterministic animation, WebGL, font, or viewport differences.

Intentional source changes should be committed and merged separately from generated screenshot artifacts.

## Local commands

Install dependencies and Chromium once:

```powershell
npm ci
npx playwright install chromium
```

Run all Playwright tests:

```powershell
npm run test:e2e
```

Run one test file:

```powershell
npm run test:e2e -- tests/npc-animation.spec.ts
```

Run one test by name:

```powershell
npm run test:e2e -- tests/npc-animation.spec.ts --grep "Lumbridge guard attack frames"
```

Run the NPC visual tests in a visible browser:

```powershell
npm run test:e2e:headed -- tests/npc-animation.spec.ts
```

Playwright starts and stops the Vite server configured in
[playwright.config.ts](../playwright.config.ts). Local runs execute the NPC WebGL
screenshots and assertions; they do not upload visual builds or compare against
remote Argos baselines because Argos upload is enabled only when `CI` is set.

Upload the current screenshots to Argos and compare them against the remote
baseline:

```bash
CI=true ARGOS_TOKEN=your-project-token npm run test:e2e
```

The equivalent PowerShell environment setup is:

```powershell
$env:CI='true'
$env:ARGOS_TOKEN='your-project-token'
npm run test:e2e
Remove-Item Env:ARGOS_TOKEN
Remove-Item Env:CI
```

Argos screenshot PNGs and Playwright HTML reports are generated artifacts. Generated directories include
`screenshots/`, `test-results/`, and `playwright-report/`; all are ignored by Git.
