---
name: mattpocock-tdd
description: Apply test-first development using RED, GREEN, REFACTOR.
---
# TDD

## Purpose
Build behavior incrementally with executable evidence.

## When to use
For features, bug fixes, or behavior changes with testable outcomes.

## Core steps
1. RED: add a focused test for the expected behavior and observe failure.
2. GREEN: implement the smallest change that satisfies it.
3. REFACTOR: improve structure without changing behavior.
4. Run focused tests after each step; keep the test covering real behavior.
5. Avoid excessive mocks and tests coupled to private implementation details.

## Attribution
Adapted from [mattpocock/skills](https://github.com/mattpocock/skills), MIT License, copyright © 2026 Matt Pocock. Adapted for OnethyCode native skills.