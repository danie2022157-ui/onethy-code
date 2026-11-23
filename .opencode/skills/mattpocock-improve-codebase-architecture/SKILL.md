---
name: mattpocock-improve-codebase-architecture
description: Improve architecture with cohesive modules and clear dependency direction.
---
# Improve Codebase Architecture

## Purpose
Improve maintainability by clarifying boundaries and reducing unnecessary coupling.

## When to use
When changes span multiple modules or architecture is obstructing a feature.

## Core steps
1. Map the current modules, ownership, and dependency direction.
2. Identify the smallest architectural boundary causing friction.
3. Prefer cohesive, deep modules with small public contracts.
4. Preserve layering and make targeted changes rather than broad rewrites.
5. Verify the affected behavior and dependent packages.

## Attribution
Adapted from [mattpocock/skills](https://github.com/mattpocock/skills), MIT License, copyright © 2026 Matt Pocock. Adapted for OnethyCode native skills.