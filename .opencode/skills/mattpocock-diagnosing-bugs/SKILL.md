---
name: mattpocock-diagnosing-bugs
description: Diagnose bugs with evidence and a root-cause regression fix.
---
# Diagnosing Bugs

## Purpose
Resolve defects by reproducing them, isolating causes, and verifying a regression fix.

## When to use
When a reported behavior is wrong or a test fails unexpectedly.

## Core steps
1. Reproduce the problem with the smallest reliable case.
2. Inspect relevant code and logs; formulate a testable hypothesis.
3. Run targeted checks or instrumentation to identify the cause.
4. Fix the underlying cause and add a regression test.
5. Run focused tests and report evidence.

## Attribution
Adapted from [mattpocock/skills](https://github.com/mattpocock/skills), MIT License, copyright © 2026 Matt Pocock. Adapted for OnethyCode native skills.