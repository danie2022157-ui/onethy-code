---
name: superpowers-writing-skills
description: Create new native skills following best practices.
---
# Writing Skills

## Purpose
Produce well-structured, testable native skills for the agent system.

## When to use
When adding a new capability or methodology as a reusable skill.

## Core steps
1. Define the purpose, when to use, and core steps concisely.
2. Use YAML frontmatter with `name`, `description`, optional `metadata`, and `disable-model-invocation`.
3. Keep the skill body short; reference tools by their native names (subagent, worktree, test, typecheck, git).
4. Test the skill by invoking it and observing behavior; refine steps based on results.
5. Include an Attribution section with upstream URL, license, copyright, and "adapted for OnethyCode native skills".

## Attribution
Adapted from [obra/superpowers](https://github.com/obra/superpowers), MIT License, copyright © 2025 Jesse Vincent. Adapted for OnethyCode native skills.