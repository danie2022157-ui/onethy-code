---
name: superpowers-writing-plans
description: Break approved designs into small, verifiable implementation tasks.
---
# Writing Plans

## Purpose
Turn an approved design into a sequence of small, independently reviewable tasks.

## When to use
After brainstorming produces an approved design and before dispatching subagents or writing code.

## Core steps
1. List each task with its outcome, exact file paths, and dependencies.
2. Keep each task small enough for one focused session (roughly 2–5 minutes of work).
3. Include concrete verification for every task (tests, typecheck, lint, or manual checks).
4. Call out ordering constraints so tasks can run serially or in parallel where safe.
5. Get the plan approved before execution.

## Attribution
Adapted from [obra/superpowers](https://github.com/obra/superpowers), MIT License, copyright © 2025 Jesse Vincent. Adapted for OnethyCode native skills.