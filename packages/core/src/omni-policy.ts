export * as OmniPolicy from "./omni-policy.js"

import { Context, Effect, Layer } from "effect"
import { Location } from "./location.js"
import { Wildcard } from "./util/wildcard.js"
import { makeLocationNode } from "@opencode/util/effect/app-node"

export interface OmniPolicyInterface {
  readonly hardDeny: (action: string, resource: string) => Effect.Effect<boolean, never>
  readonly addHardDeny: (action: string, resource: string) => Effect.Effect<void, never>
  readonly removeHardDeny: (action: string, resource: string) => Effect.Effect<void, never>
  readonly listHardDeny: () => Effect.Effect<ReadonlyArray<{ action: string; resource: string }>, never>
}

export class Service extends Context.Service<Service, OmniPolicyInterface>()("@opencode/OmniPolicy") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const rules = new Set<string>()

    const key = (action: string, resource: string) => `${action}\0${resource}`

    if (process.env.OMNICODE_ACTIVE === "1") {
      rules.add(key("edit", "**/.git/hooks/*"))
      rules.add(key("write", "**/.git/hooks/*"))
      rules.add(key("read", "**/.ssh/id_*"))
      rules.add(key("write", "**/.ssh/id_*"))
    }

    const hardDenyImpl = Effect.fn("OmniPolicy.hardDeny")(function* (action: string, resource: string) {
      if (rules.has(key(action, resource))) return true
      for (const entry of rules) {
        const parts = entry.split("\0")
        const ruleAction = parts[0] ?? ""
        const ruleResource = parts[1] ?? ""
        if (Wildcard.match(action, ruleAction) && Wildcard.match(resource, ruleResource)) {
          return true
        }
      }
      return false
    })

    const hardDeny: (action: string, resource: string) => Effect.Effect<boolean, never> = hardDenyImpl

    const addHardDenyImpl = Effect.fn("OmniPolicy.addHardDeny")(function* (action: string, resource: string) {
      rules.add(key(action, resource))
    })

    const addHardDeny: (action: string, resource: string) => Effect.Effect<void, never> = addHardDenyImpl

    const removeHardDenyImpl = Effect.fn("OmniPolicy.removeHardDeny")(function* (action: string, resource: string) {
      rules.delete(key(action, resource))
    })

    const removeHardDeny: (action: string, resource: string) => Effect.Effect<void, never> = removeHardDenyImpl

    const listHardDenyImpl = Effect.fn("OmniPolicy.listHardDeny")(function* () {
      return [...rules].map((k) => {
        const parts = k.split("\0")
        return { action: parts[0] ?? "", resource: parts[1] ?? "" }
      })
    })

    const listHardDeny: () => Effect.Effect<ReadonlyArray<{ action: string; resource: string }>, never> = listHardDenyImpl

    return Service.of({ hardDeny, addHardDeny, removeHardDeny, listHardDeny })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Location.node],
})
