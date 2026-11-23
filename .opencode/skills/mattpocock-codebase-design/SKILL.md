---
name: mattpocock-codebase-design
description: Design modular, cohesive code with clear boundaries and interfaces.
---
# Codebase Design

## Purpose
Create modular architecture with cohesive units and minimal public surfaces.

## When to use
Before or during implementation when design choices affect maintainability.

## Core steps
1. Identify responsibilities and group related logic into cohesive modules.
2. Keep public interfaces small and abstract internal details.
3. Prefer dependency direction that prevents circular imports.
4. Avoid over-abstracting; extract only when concepts are reused or complex.
5. Verify the design supports current requirements without speculative overengineering.

## Attribution
Adapted from [mattpocock/skills](https://github.com/mattpocock/skills), MIT License, copyright © 2026 Matt Pocock. Adapted for OnethyCode native skills.