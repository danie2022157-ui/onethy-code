export type MemoryScope = "project" | "global"

export interface MemoryFileInfo {
  readonly id: string
  readonly name: string
  readonly label: string
  readonly relativePath: string
  readonly description: string
  readonly defaultContent: string
}

export const PROJECT_MEMORY_TEMPLATES: Record<string, { label: string; description: string; defaultContent: string }> = {
  "active-context.md": {
    label: "Active Context",
    description: "Current sprint, immediate goals, active decisions and next steps.",
    defaultContent: `# Active Context

## Current Goals
- Implementation of full parity between OnethyCode Desktop App and TUI
- Zero code duplication between client packages

## Active Decisions
- All business logic lives in shared packages (@opencode/client)

## Next Steps
- Verify desktop app functionality
`,
  },
  "project-brief.md": {
    label: "Project Brief",
    description: "Core vision, high-level scope, key requirements and target users.",
    defaultContent: `# Project Brief

## Overview
OnethyCode is an intelligent coding assistant combining terminal TUI and desktop interfaces.

## Core Vision
Deliver full feature parity, maximum performance, and persistent memory across developer workflows.
`,
  },
  "system-patterns.md": {
    label: "System Patterns",
    description: "Architectural patterns, key conventions, data flow, and code structure.",
    defaultContent: `# System Patterns

## Architecture
- Client-Server architecture with Effect-TS protocol
- Shared client modules in @opencode/client
- Reactive SolidJS frontends for both TUI and Desktop App

## Code Conventions
- No code duplication across frontends
- Strict schema validation at boundaries
`,
  },
  "tech-context.md": {
    label: "Tech Context",
    description: "Technology stack, dependencies, runtime environments, and development commands.",
    defaultContent: `# Tech Context

## Runtime & Stack
- Bun runtime
- SolidJS + Kobalte UI
- Electron Desktop App
- OpenTUI Terminal Interface

## Build & Test Commands
- bun run build
- bun test
- bun typecheck
`,
  },
  "memory.md": {
    label: "Project Notes",
    description: "Durable project notes, historical context, and team decisions.",
    defaultContent: `# Durable Project Memory

Important technical decisions and long-term knowledge.
`,
  },
}

export const GLOBAL_MEMORY_TEMPLATES: Record<string, { label: string; description: string; defaultContent: string }> = {
  "preferences.md": {
    label: "User Preferences",
    description: "Coding style preferences, favorite tools, and global conventions.",
    defaultContent: `# Global Preferences

## Coding Style
- Clean, concise code
- Early returns over nested conditionals
- Type inference where possible
`,
  },
  "rules.md": {
    label: "Global Rules",
    description: "User-wide safety and behavioral rules applied to all projects.",
    defaultContent: `# Global Rules

- Follow conventional commits
- Never duplicate business logic between UI and CLI
- Run typecheck and tests before finalizing tasks
`,
  },
  "knowledge.md": {
    label: "Global Knowledge",
    description: "Cross-project knowledge base, tips, and reusable patterns.",
    defaultContent: `# Global Knowledge Base

Reusable technical patterns, tips, and cross-project knowledge.
`,
  },
}

export function getMemoryFilePath(scope: MemoryScope, filename: string): string {
  if (scope === "global") {
    return `.config/opencode/memory-bank/${filename}`
  }
  if (filename === "memory.md") {
    return `.omnicode/${filename}`
  }
  return `.omnicode/memory-bank/${filename}`
}

export function getMemoryFiles(scope: MemoryScope): MemoryFileInfo[] {
  const templates = scope === "global" ? GLOBAL_MEMORY_TEMPLATES : PROJECT_MEMORY_TEMPLATES
  return Object.entries(templates).map(([name, meta]) => ({
    id: name,
    name,
    label: meta.label,
    relativePath: getMemoryFilePath(scope, name),
    description: meta.description,
    defaultContent: meta.defaultContent,
  }))
}
