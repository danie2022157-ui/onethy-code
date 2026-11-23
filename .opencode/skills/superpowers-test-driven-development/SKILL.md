---
name: superpowers-test-driven-development
description: Enforce the RED-GREEN-REFACTOR cycle during implementation.
---
# Test-Driven Development

## Purpose
Drive implementation with tests so behavior is verified before code exists.

## When to use
During implementation of any feature or bug fix that has observable behavior.

## Core steps
1. RED: write a failing test that expresses the desired behavior; watch it fail for the right reason.
2. GREEN: write the minimal code to make the test pass.
3. REFACTOR: clean up the code while keeping tests green.
4. Never keep code that was written before its test; delete it and redo test-first.
5. Avoid testing anti-patterns (over-mocking, testing internals, brittle fixtures).

## Attribution
Adapted from [obra/superpowers](https://github.com/obra/superpowers), MIT License, copyright © 2025 Jesse Vincent. Adapted for OnethyCode native skills.