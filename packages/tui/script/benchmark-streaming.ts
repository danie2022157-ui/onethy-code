import { createTestRenderer } from "@opentui/core/testing"
import { resolveMiniSettings } from "../src/mini/runtime.boot"
import { RunFooter } from "../src/mini/footer"
import { RUN_THEME_MONO } from "../src/mini/theme"
import { createTuiResolvedConfig } from "../test/fixture/tui-runtime"
import type { StreamCommit } from "../src/mini/types"

const iterations = Math.max(1, Number(process.argv[2] ?? 5))
const deltas = Math.max(1, Number(process.argv[3] ?? 10_000))

const setup = async () => {
  const app = await createTestRenderer({
    width: 112,
    height: 24,
    exitOnCtrlC: false,
    screenMode: "split-footer",
    footerHeight: 4,
    externalOutputMode: "capture-stdout",
  })
  const footer = new RunFooter(app.renderer, {
    directory: () => "/benchmark",
    findFiles: async () => [],
    agents: [{ id: "build", name: "Build", mode: "primary", hidden: false }],
    references: [],
    agent: "build",
    modelLabel: "benchmark",
    model: undefined,
    variant: undefined,
    first: true,
    theme: RUN_THEME_MONO,
    tuiConfig: createTuiResolvedConfig(),
    miniSettings: { current: { ...resolveMiniSettings(), mono: true } },
    onPermissionReply: () => {},
    onFormReply: () => {},
    onFormCancel: () => {},
    onEditorOpen: async () => undefined,
    subscribeThemeSignal: () => () => {},
  })
  return { app, footer }
}

const commit = (index: number): StreamCommit => ({
  kind: "system",
  source: "system",
  phase: "progress",
  text: `delta-${index} `,
  messageID: "bench-message",
  partID: "bench-part",
})

const measure = async (mode: "burst" | "microtask") => {
  const { app, footer } = await setup()
  const started = performance.now()
  try {
    for (let index = 0; index < deltas; index++) {
      footer.append(commit(index))
      if (mode === "microtask") await Promise.resolve()
    }
    const appendedAt = performance.now()
    await footer.idle()
    const settledAt = performance.now()
    return {
      mode,
      deltas,
      appendMs: appendedAt - started,
      settleMs: settledAt - appendedAt,
      totalMs: settledAt - started,
      deltasPerSecond: (deltas * 1_000) / (appendedAt - started),
    }
  } finally {
    footer.destroy()
    app.renderer.destroy()
  }
}

for (let index = 0; index < 2; index++) await measure("burst")
const results = { generatedAt: new Date().toISOString(), iterations, deltas, cases: {} as Record<string, unknown[]> }
for (const mode of ["burst", "microtask"] as const) {
  results.cases[mode] = []
  for (let index = 0; index < iterations; index++) results.cases[mode].push(await measure(mode))
}
console.log(JSON.stringify(results, null, 2))