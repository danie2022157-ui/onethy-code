---
name: mattpocock-setup-matt-pocock-skills
description: Set up locally authored engineering skills using native OnethyCode conventions.
---
# Setup Matt Pocock Skills

## Purpose
Organize locally authored skill guidance using the native skill loader.

## When to use
When adding or registering reusable engineering practices in this repository.

## Core steps
1. Place each skill at `.opencode/skills/<id>/SKILL.md`.
2. Use only supported frontmatter: `name`, `description`, `metadata`, `disable-model-invocation`.
3. Register its directory in `.opencode/opencode.jsonc` when required by project setup.
4. Include purpose, usage context, actionable native steps, and attribution.
5. Validate paths and parseable frontmatter; do not install external packages or execute untrusted scripts.

## Attribution
Adapted from [mattpocock/skills](https://github.com/mattpocock/skills), MIT License, copyright © 2026 Matt Pocock. Adapted for OnethyCode native skills.