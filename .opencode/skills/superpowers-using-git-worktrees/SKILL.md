---
name: superpowers-using-git-worktrees
description: Create isolated branches and worktrees for parallel development.
---
# Using Git Worktrees

## Purpose
Isolate work per task or branch using Git worktrees so changes don't interfere.

## When to use
Before starting implementation tasks, especially when running subagents or parallel work.

## Core steps
1. Create a new branch from the integration target (usually `origin/dev`).
2. Initialize a worktree in a clean directory.
3. Run project setup (install, build, test) to establish a clean baseline.
4. Perform work inside the worktree.
5. On completion, the worktree can be merged, PR'd, kept, or discarded.

## Attribution
Adapted from [obra/superpowers](https://github.com/obra/superpowers), MIT License, copyright © 2025 Jesse Vincent. Adapted for OnethyCode native skills.