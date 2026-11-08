import { describe, expect, test } from "bun:test"
import {
  AUTO_SKILL_MAX_CHARS,
  autoSkillContextBudget,
  isExecutableSkill,
  renderAutoPersonalizationHints,
  selectAllowedSkillAttachments,
  selectAutoPersonalizations,
} from "../src/auto-personalizations"

describe("automatic contextual personalizations", () => {
  const catalog = {
    skills: [
      { id: "frameworks-react-testing", description: "React component testing", content: "Use React Testing Library." },
      { id: "programming-python", description: "Python API development", content: "Use safe Python patterns." },
      { id: "hook-react", description: "React hook descriptor", content: "Inert JSON" },
      { id: "mod-react", description: "React mod descriptor", content: "Inert JSON" },
      { id: "frameworks-react-blocked", description: "React debugging", autoinvoke: false, content: "Never auto load." },
    ],
    agents: [
      { id: "frameworks-react-specialist", description: "AITmpl specialist: React", mode: "subagent" },
      { id: "programming-python-pro", description: "AITmpl specialist: Python", mode: "subagent" },
      { id: "security-pentester", description: "Penetration testing", mode: "primary" },
    ],
    commands: [{ id: "frameworks-react-review", description: "Review React components" }],
    mcpTools: [{ id: "playwright/browser_navigate", description: "React website browser navigation" }],
  }

  test("selects relevant resource IDs and ignores inert descriptors", () => {
    const selected = selectAutoPersonalizations("Corrija meu componente React", catalog)
    expect(selected.skills).toContain("frameworks-react-testing")
    expect(selected.skills).not.toContain("hook-react")
    expect(selected.skills).not.toContain("mod-react")
    expect(selected.skills).not.toContain("frameworks-react-blocked")
    expect(selected.agents).toEqual(["frameworks-react-specialist"])
    expect(selected.commands).toEqual(["frameworks-react-review"])
    expect(selected.mcpTools).toEqual([])
    const browserTask = selectAutoPersonalizations("Use Playwright para navegar no browser", catalog)
    expect(browserTask.mcpTools).toContain("playwright/browser_navigate")
  })

  test("does not attach anything to vague requests", () => {
    expect(selectAutoPersonalizations("faça isso para mim", catalog)).toEqual({
      skills: [], agents: [], commands: [], mcpTools: [],
    })
  })

  test("keeps the skill permission gate and explicit attachments", () => {
    const selected = selectAllowedSkillAttachments(
      ["frameworks-react-testing", "programming-python"],
      catalog.skills,
      (id) => id === "frameworks-react-testing",
    )
    expect(selected).toEqual(["frameworks-react-testing"])
    expect(selectAllowedSkillAttachments(
      ["frameworks-react-testing"], catalog.skills, () => true, ["frameworks-react-testing"],
    )).toEqual([])
    expect(selectAllowedSkillAttachments(
      ["frameworks-react-testing"], catalog.skills, () => false,
    )).toEqual([])
  })

  test("autonomously attaches more than two distinct skills when relevant and space permits", () => {
    const skills = [
      { id: "frameworks-react-testing", description: "React testing tests", content: "test".repeat(200) },
      { id: "frameworks-react-routing", description: "React routing navigation", content: "route".repeat(200) },
      { id: "frameworks-react-accessibility", description: "React accessible design", content: "access".repeat(200) },
      { id: "frameworks-react-performance", description: "React performance optimisation", content: "perf".repeat(200) },
      { id: "frameworks-react-security", description: "React security assessment", content: "secure".repeat(200) },
    ]
    const prompt = "Implemente React testing routing accessibility performance security"
    const selection = selectAutoPersonalizations(prompt, { ...catalog, skills })
    expect(selection.skills.length).toBeGreaterThan(2)
    const attached = selectAllowedSkillAttachments(
      selection.skills, skills, () => true, [], { prompt, contextTokens: 128_000 },
    )
    expect(attached.length).toBeGreaterThan(2)
    expect(new Set(attached).size).toBe(attached.length)
  })

  test("adapts the context allowance to the model window and task breadth", () => {
    const simple = autoSkillContextBudget({ prompt: "React", contextTokens: 16_000 }, 1)
    const complex = autoSkillContextBudget({
      prompt: "React routing security testing accessibility design optimization performance architecture",
      contextTokens: 200_000,
    }, 8)
    expect(complex).toBeGreaterThan(simple)
    expect(complex).toBeLessThanOrEqual(60_000)
    expect(autoSkillContextBudget({ prompt: "React", contextTokens: 16_000, reservedChars: 100_000 }, 1)).toBe(0)
  })

  test("skips oversize skills and respects small context budgets", () => {
    const huge = { id: "react-huge", description: "React", content: "x".repeat(AUTO_SKILL_MAX_CHARS + 1) }
    const normal = { id: "react-small", description: "React", content: "safe".repeat(100) }
    expect(selectAllowedSkillAttachments(
      ["react-huge", "react-small"], [huge, normal], () => true, [],
      { prompt: "React", contextTokens: 128_000 },
    )).toEqual(["react-small"])
    expect(selectAllowedSkillAttachments(
      ["react-small"], [normal], () => true, [],
      { prompt: "React", contextTokens: 1_000 },
    )).toEqual([])
    expect(isExecutableSkill({ id: "plugin-custom", content: "test" })).toBe(false)
    expect(isExecutableSkill({ id: "example", path: "/global/settings/onethy/ref.json" })).toBe(false)
  })

  test("avoids near-duplicate instructions when packing an autonomous skill set", () => {
    const skills = [
      { id: "frameworks-react-testing", description: "React component testing", content: "A" },
      { id: "frameworks-react-testing-2", description: "React component testing", content: "B" },
      { id: "frameworks-react-routing", description: "React navigation routing", content: "C" },
    ]
    const result = selectAllowedSkillAttachments(
      skills.map((s) => s.id), skills, () => true, [],
      { prompt: "React routing and testing", contextTokens: 64_000 },
    )
    expect(result).toContain("frameworks-react-testing")
    expect(result).not.toContain("frameworks-react-testing-2")
    expect(result).toContain("frameworks-react-routing")
  })

  test("renders only registry IDs, not untrusted skill contents", () => {
    const selected = selectAutoPersonalizations("Corrija meu componente React", catalog)
    const text = renderAutoPersonalizationHints(selected, ["frameworks-react-testing"])
    expect(text).toContain("Automatically loaded skill attachments: frameworks-react-testing")
    expect(text).toContain("subagent agent=auto")
    expect(text).toContain("do not invoke automatically")
    expect(text).not.toContain("Use React Testing Library.")
  })
})
