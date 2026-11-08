import { describe, expect, test } from "bun:test"
import {
  isExecutableSkill,
  MAX_SKILL_CHARS,
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

  test("selects task-relevant resources without interpreting descriptors as executable skills", () => {
    const selected = selectAutoPersonalizations("Corrija meu componente React", catalog)
    expect(selected.skills).toContain("frameworks-react-testing")
    expect(selected.skills).not.toContain("hook-react")
    expect(selected.skills).not.toContain("mod-react")
    expect(selected.skills).not.toContain("frameworks-react-blocked")
    expect(selected.agents).toEqual(["frameworks-react-specialist"])
    expect(selected.commands).toEqual(["frameworks-react-review"])
    expect(selected.mcpTools).toContain("playwright/browser_navigate")
  })

  test("does not inject specializations for vague prompts", () => {
    expect(selectAutoPersonalizations("faça isso para mim", catalog)).toEqual({
      skills: [], agents: [], commands: [], mcpTools: [],
    })
  })

  test("loads only allow-approved skills and preserves explicit attachments", () => {
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

  test("caps auto context and excludes descriptor paths", () => {
    expect(isExecutableSkill({ id: "custom-plugin", content: "test" })).toBe(false)
    expect(isExecutableSkill({ id: "example", path: "/global/settings/onethy/ref.json" })).toBe(false)
    const huge = { id: "react-huge", description: "React", content: "x".repeat(MAX_SKILL_CHARS + 1) }
    expect(selectAllowedSkillAttachments(["react-huge"], [huge], () => true)).toEqual([])
  })

  test("renders validated resource IDs but not untrusted content as privileged instructions", () => {
    const selected = selectAutoPersonalizations("Corrija meu componente React", catalog)
    const text = renderAutoPersonalizationHints(selected, ["frameworks-react-testing"])
    expect(text).toContain("Automatically loaded skill attachments: frameworks-react-testing")
    expect(text).toContain("subagent agent=auto")
    expect(text).toContain("do not invoke automatically")
    expect(text).not.toContain("Use React Testing Library.")
  })
})
