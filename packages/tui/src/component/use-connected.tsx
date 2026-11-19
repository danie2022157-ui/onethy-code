import { createMemo } from "solid-js"
import { useData } from "../context/data"
import { useLocation } from "../context/location"
import { hasConnectedProvider } from "../util/connected-provider"

export function useConnected() {
  const data = useData()
  const location = useLocation()
  return createMemo(() => {
    const loc = location.ref ?? data.location.default()
    const integrations = data.location.integration.list(loc) ?? []
    if (hasConnectedProvider(integrations)) return true

    const configDocs = data.location.config.list(loc) ?? []
    const hasCustom = configDocs.some(
      (doc) => doc.type === "document" && doc.info.providers && Object.keys(doc.info.providers).length > 0,
    )
    if (hasCustom) return true

    const providers = data.location.provider.list(loc) ?? []
    if (
      providers.some(
        (p) =>
          p.activation === "enabled" ||
          Boolean((p.settings as Record<string, unknown> | undefined)?.apiKey),
      )
    ) {
      return true
    }

    const models = data.location.model.list(loc) ?? []
    return models.some((m) => m.providerID !== "opencode" && m.status !== "deprecated")
  })
}
