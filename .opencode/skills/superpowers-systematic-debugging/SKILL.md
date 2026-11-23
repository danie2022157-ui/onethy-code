---
name: superpowers-systematic-debugging
description: Apply a four-phase root-cause process to defects.
---
# Systematic Debugging

## Purpose
Find the root cause of a bug through evidence, not guesswork.

## When to use
Whenever behavior is wrong and the cause is unknown.

## Core steps
1. Reproduce: confirm the failure and capture a minimal reproduction.
2. Isolate: narrow to the smallest failing unit (bisect, remove variables).
3. Explain: form a hypothesis, then prove or disprove it with targeted instrumentation.
4. Fix and verify: address the root cause, add a regression test, and confirm the fix.
5. Apply defense-in-depth and condition-based waiting where flakiness or timing is involved.

## Attribution
Adapted from [obra/superpowers](https://github.com/obra/superpowers), MIT License, copyright © 2025 Jesse Vincent. Adapted for OnethyCode native skills.