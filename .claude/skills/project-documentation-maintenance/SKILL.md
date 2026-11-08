---
name: project-documentation-maintenance
description: Maintains existing project documentation when implementation changes. Use for every code, configuration, or workflow change that may make existing documentation stale.
---

# Project documentation maintenance

Apply this workflow to every implementation change.

## Required checks

Before editing:

1. Read the existing files under `docs/`.
2. Search repository documentation for the changed behavior, symbols, commands, configuration, workflows, or file paths.
3. Identify documentation that can become incorrect or incomplete because of the change.

After editing:

1. Check `docs/` again against the final implementation.
2. Correct only existing documentation that is now inaccurate or incomplete.
3. Preserve existing documentation scope, structure, terminology, and formatting.
4. Report each documentation correction made.

## Documentation creation

Do not create documentation unless the user explicitly requests documentation.

This includes:

- New Markdown files.
- Added sections or pages.
- README additions.
- API or architecture documentation.
- New guides, plans, design notes, runbooks, or examples.

The prohibition does not apply to retroactive corrections of documentation that already exists.

## Change examples

When a changed behavior affects existing docs:

- Update an existing command if a script or workflow changes.
- Update an existing architecture description after moving ownership or responsibilities.
- Update existing configuration instructions after changing environment variables or settings.
- Update existing screenshots or behavior descriptions after changing the UI, without creating new documentation.

When existing docs do not cover the change:

- Do not add coverage unless the user asks.
- State that no existing documentation required correction.
