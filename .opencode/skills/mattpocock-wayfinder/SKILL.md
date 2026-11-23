---
name: mattpocock-wayfinder
description: Navigate an unfamiliar codebase to locate relevant modules and conventions.
---
# Wayfinder

## Purpose
Find the right place to make a change in an unfamiliar repository.

## When to use
At the start of work when the relevant code paths are not yet known.

## Core steps
1. Search code and docs by user-facing behavior and domain terms.
2. Trace the main call path and identify ownership boundaries.
3. Read adjacent tests and conventions before editing.
4. Report the likely files and dependencies, then proceed with the narrowest change.

## Attribution
Adapted from [mattpocock/skills](https://github.com/mattpocock/skills), MIT License, copyright © 2026 Matt Pocock. Adapted for OnethyCode native skills.