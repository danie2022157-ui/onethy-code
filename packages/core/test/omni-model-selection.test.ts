import { describe, expect, it } from "bun:test"
import { Model } from "@opencode/core/model"
import { Money } from "@opencode/schema/money"
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

  it("never silently selects a cooled-down model when strict routing is enabled", () => {
    const available = [info("p", "a"), info("p", "b")]
    expect(() => ModelSelectionPolicy.select(available, {
      mode: "automatic",
      requireHealthy: true,
      isCoolingDown: () => true,
    })).toThrow(ModelSelectionPolicy.NoHealthyModelCandidateError)
    const selected = ModelSelectionPolicy.select(available, {
      mode: "automatic",
      requireHealthy: true,
      isCoolingDown: (ref) => ref.id === "a",
    })
    expect(String(selected.selected.id)).toBe("b")
    const explicit = ModelSelectionPolicy.select(available, {
      mode: "explicit",
      requireHealthy: true,
      isCoolingDown: () => true,
    }, { providerID: Provider.ID.make("p"), id: Model.ID.make("a") })
    expect(String(explicit.selected.id)).toBe("a")
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

  it("chooses cheapest eligible connected model when cost ranking is requested", () => {
    const amount = Money.USDPerMillionTokens.make
    const expensive = info("p", "a-expensive", { cost: [{ input: amount(15), output: amount(25), cache: { read: amount(0), write: amount(0) } }]  })
    const cheap = info("p", "z-cheap", { cost: [{ input: amount(0.5), output: amount(1), cache: { read: amount(0), write: amount(0) } }]  })
    const decision = ModelSelectionPolicy.select([expensive, cheap], { mode: "automatic", rankBy: "cost" })
    expect(String(decision.selected.id)).toBe("z-cheap")
  })

  it("uses weighted input, output and cache prices instead of just an input price", () => {
    const amount = Money.USDPerMillionTokens.make
    const cheapInput = info("p", "cheap-input-expensive-output", {
      cost: [{ input: amount(0.1), output: amount(30), cache: { read: amount(0.1), write: amount(0.1) } }],
    })
    const balanced = info("p", "balanced", {
      cost: [{ input: amount(2), output: amount(2), cache: { read: amount(1), write: amount(2) } }],
    })
    expect(String(ModelSelectionPolicy.select([cheapInput, balanced], {
      mode: "automatic", rankBy: "cost",
    }).selected.id)).toBe("balanced")
  })

  it("supports context requirements and context ranking", () => {
    const small = info("p", "a-small", { limit: { context: 20_000, output: 8_000 } })
    const large = info("p", "z-large", { limit: { context: 200_000, output: 8_000 } })
    const decision = ModelSelectionPolicy.select([small, large], {
      mode: "automatic",
      minimumContext: 64_000,
      rankBy: "context",
    })
    expect(String(decision.selected.id)).toBe("z-large")
    expect(decision.candidateCount).toBe(1)
  })
})
