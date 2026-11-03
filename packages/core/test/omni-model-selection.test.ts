import { describe, expect, it } from "bun:test"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { ModelSelectionPolicy } from "@opencode/core/model-selection-policy"

const info = (providerID: string, id: string, options: Partial<Model.Info> = {}): Model.Info => ({
  ...Model.Info.default(Provider.ID.make(providerID), Model.ID.make(id)),
  providerID: Provider.ID.make(providerID),
  id: Model.ID.make(id),
  modelID: Model.ID.make(id),
  ...options,
})

describe("model selection policy", () => {
  it("ranks only live catalog candidates and keeps deterministic order", () => {
    const available = [info("p", "z"), info("p", "a")]
    const selected = ModelSelectionPolicy.select(available, { mode: "automatic" })
    expect(String(selected.selected?.id)).toBe("a")
    expect(selected.candidateCount).toBe(2)
  })

  it("fails closed when an allowlist has no live match", () => {
    expect(() => ModelSelectionPolicy.select([info("p", "a")], {
      mode: "automatic",
      allowedModels: ["p/missing"],
    })).toThrow(ModelSelectionPolicy.NoModelCandidateError)
  })

  it("does not use cooldown to exclude every eligible candidate", () => {
    const available = [info("p", "a"), info("p", "b")]
    const selected = ModelSelectionPolicy.select(available, {
      mode: "automatic",
      isCoolingDown: () => true,
    })
    expect(String(selected.selected?.id)).toBe("a")
  })

  it("avoids cooled models automatically but keeps an explicit session model pinned", () => {
    const available = [info("p", "a"), info("p", "b")]
    const isCoolingDown = (ref: Model.Ref) => ref.id === "a"
    const automatic = ModelSelectionPolicy.select(available, { mode: "automatic", isCoolingDown })
    // SessionRunnerModel resolves persisted session.model through this explicit branch.
    const explicitSessionModel = ModelSelectionPolicy.select(available, { mode: "explicit", isCoolingDown }, {
      providerID: Provider.ID.make("p"),
      id: Model.ID.make("a"),
    })

    expect(String(automatic.selected.id)).toBe("b")
    expect(String(explicitSessionModel.selected.id)).toBe("a")
    expect(explicitSessionModel.reason).toBe("explicit")
  })

  it("selects only enabled chat models that support tools for automatic subagents", () => {
    const selected = ModelSelectionPolicy.select(
      [
        info("p", "a-image", { type: "image", enabled: true }),
        info("p", "b-no-tools", { type: "chat", enabled: true, capabilities: { ...Model.Capabilities.default(), tools: false } }),
        info("p", "c-chat-tools", { type: "chat", enabled: true, capabilities: { ...Model.Capabilities.default(), tools: true } }),
      ],
      { mode: "automatic", requiredTypes: ["chat"], requiredCapabilities: { tools: true } },
    )

    expect(String(selected.selected.id)).toBe("c-chat-tools")
    expect(selected.candidateCount).toBe(1)
  })
})
