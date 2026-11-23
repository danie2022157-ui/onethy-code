---
name: superpowers-executing-plans
description: Execute an approved plan inline with a single final review.
---
# Executing Plans

## Purpose
Implement all tasks from an approved plan in the current session, then review the whole change once.

## When to use
When a plan is approved and tasks are small enough to run in one context without per-task isolation.

## Core steps
1. Work through the plan task by task in order, honoring dependencies.
2. Run the specified verification after each task before moving on.
3. If a task fails, diagnose with root-cause analysis rather than patching blindly.
4. After all tasks pass, review the full branch for spec compliance and code quality.
5. Present results and next steps to the user.

## Attribution
Adapted from [obra/superpowers](https://github.com/obra/superpowers), MIT License, copyright © 2025 Jesse Vincent. Adapted for OnethyCode native skills.