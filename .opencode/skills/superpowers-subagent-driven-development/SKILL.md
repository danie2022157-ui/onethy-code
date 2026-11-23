---
name: superpowers-subagent-driven-development
description: Dispatch a fresh subagent per task with review after each.
---
# Subagent-Driven Development

## Purpose
Execute a plan by dispatching a fresh subagent for each task and reviewing its work before proceeding.

## When to use
When maximum thoroughness matters and tasks are independent enough to isolate per subagent.

## Core steps
1. For each task, spawn a subagent with the task scope, file paths, and verification steps.
2. After the subagent reports, review its changes against the task spec before continuing.
3. If the work fails review, send targeted feedback or re-dispatch the task.
4. Keep the main session's context lean by delegating implementation and reading results.
5. Complete the mission with evidence of verified results.

## Attribution
Adapted from [obra/superpowers](https://github.com/obra/superpowers), MIT License, copyright © 2025 Jesse Vincent. Adapted for OnethyCode native skills.