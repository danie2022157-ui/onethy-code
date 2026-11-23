---
name: superpowers-verification-before-completion
description: Confirm a fix or feature actually works before declaring done.
---
# Verification Before Completion

## Purpose
Ensure the work is genuinely complete and verified before reporting success.

## When to use
Before claiming any task is finished.

## Core steps
1. Run the project's build or typecheck and resolve any errors.
2. Run relevant tests, including new regression tests for the change.
3. Exercise the change manually or via E2E when feasible.
4. Check edge cases and failure modes introduced by the change.
5. Report exactly what was verified and what could not be verified.

## Attribution
Adapted from [obra/superpowers](https://github.com/obra/superpowers), MIT License, copyright © 2025 Jesse Vincent. Adapted for OnethyCode native skills.