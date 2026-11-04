/** Validation and scheduling for dependency-aware OnethyCode missions. */
export * as OmniTaskGraph from "./omni-task-graph.js"

export interface Definition {
  readonly id: string
  readonly title: string
  readonly assignedAgent: string
  readonly dependsOn?: ReadonlyArray<string>
}
export interface Node extends Definition {
  status: "pending" | "running" | "completed" | "failed"
}

export function validate(definitions: ReadonlyArray<Definition>): void {
  if (definitions.length < 1 || definitions.length > 32) throw new Error("Plan must contain between 1 and 32 tasks")
  const map = new Map<string, Definition>()
  for (const task of definitions) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/.test(task.id)) throw new Error("Invalid task ID: " + task.id)
    if (!task.title.trim() || task.title.length > 500 || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/.test(task.assignedAgent))
      throw new Error("Invalid task title or agent: " + task.id)
    if (map.has(task.id)) throw new Error("Duplicate task ID: " + task.id)
    map.set(task.id, task)
  }
  const active = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string) => {
    if (active.has(id)) throw new Error("Cyclic dependencies at " + id)
    if (visited.has(id)) return
    active.add(id)
    const deps = map.get(id)!.dependsOn ?? []
    if (new Set(deps).size !== deps.length) throw new Error("Repeated dependency for " + id)
    for (const dep of deps) {
      if (!map.has(dep)) throw new Error("Unknown dependency " + dep + " for " + id)
      visit(dep)
    }
    active.delete(id)
    visited.add(id)
  }
  for (const id of map.keys()) visit(id)
}

/** Select only prerequisites-complete tasks, bounded by remaining parallel slots. */
export function ready<T extends Node>(tasks: ReadonlyArray<T>, maxParallel: number): T[] {
  if (!Number.isInteger(maxParallel) || maxParallel < 1 || maxParallel > 8) return []
  const running = tasks.filter((task) => task.status === "running").length
  const remaining = maxParallel - running
  if (remaining < 1) return []
  const status = new Map(tasks.map((task) => [task.id, task.status]))
  return tasks.filter((task) =>
    task.status === "pending" && (task.dependsOn ?? []).every((dep) => status.get(dep) === "completed"),
  ).slice(0, remaining)
}
