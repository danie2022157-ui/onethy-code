---
name: superpowers-dispatching-parallel-agents
description: Run independent subagent tasks concurrently.
---
# Dispatching Parallel Agents

## Purpose
Accelerate work by dispatching multiple independent subagents at once.

## When to use
When tasks are independent and can run without shared mutable state.

## Core steps
1. Confirm tasks have no ordering dependencies or shared writes.
2. Group independent tasks into a parallel batch.
3. Dispatch via the subagent tool, ideally isolated in worktrees for edits.
4. Collect and verify each result before integrating.
5. Fall back to serial execution when dependencies exist.

## Attribution
Adapted from [obra/superpowers](https://github.com/obra/superpowers), MIT License, copyright © 2025 Jesse Vincent. Adapted for OnethyCode native skills.