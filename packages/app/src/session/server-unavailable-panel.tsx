import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useServer } from "@/runtime/server/current"
import { useGlobal } from "@/runtime/server/runtime"
import { useServers } from "@/runtime/server/registry"

export function ServerUnavailablePanel(props: { reason: "incompatible" | "unreachable"; onClose?: () => void }) {
  const language = useLanguage()
  const server = useServer()
  const servers = useServers()
  const global = useGlobal()
  const [state, setState] = createStore({ retrying: false, error: undefined as string | undefined })

  const retry = () => {
    setState({ retrying: true, error: undefined })
    void global.servers
      .retry()
      .catch((error) => setState("error", error instanceof Error ? error.message : language.t("common.requestFailed")))
      .finally(() => setState("retrying", false))
  }

  return (
    <div class="flex-1 min-h-0 overflow-hidden">
      <div class="h-full px-6 pb-42 -mt-4 flex flex-col items-center justify-center text-center gap-4">
        <Icon name="outline-hexagonal-warning" size="large" class="text-v2-state-fg-danger" />
        <div class="flex flex-col items-center gap-2">
          <div class="text-16-medium text-text max-w-md">
            {props.reason === "incompatible"
              ? language.t("session.error.incompatible")
              : language.t("session.error.unreachable")}
          </div>
          <div class="text-13-regular text-text-weak max-w-md">
            {props.reason === "incompatible"
              ? language.t("session.error.incompatible.description", {
                  server: servers.label(server.conn),
                  version: server.health?.version ?? "1",
                })
              : language.t("session.error.unreachable.description", { server: servers.label(server.conn) })}
          </div>
        </div>
        <Show when={props.reason === "unreachable"}>
          <Button variant="neutral" size="normal" icon="refresh" disabled={state.retrying} onClick={retry}>
            {language.t("common.retry")}
          </Button>
          <Show when={state.error}>
            {(error) => <div class="text-11-regular text-v2-state-fg-danger" role="alert">{error()}</div>}
          </Show>
        </Show>
        <Show when={props.onClose}>
          <Button variant="neutral" size="normal" icon="xmark-small" onClick={() => props.onClose?.()}>
            {language.t("session.error.notFound.closeTab")}
          </Button>
        </Show>
      </div>
    </div>
  )
}
