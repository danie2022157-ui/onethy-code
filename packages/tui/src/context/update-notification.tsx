import { createSignal, onCleanup, onMount } from "solid-js"
import { createSimpleContext } from "./helper"
import { useLog } from "./log"
import { useStorage } from "./storage"
import { useEvent } from "./event"
import { errorMessage } from "../util/error"
import { useExit } from "./exit"
import { useEpilogue } from "./epilogue"
import { useDialog } from "../ui/dialog"
import { DialogUpdate } from "../component/dialog-update"
import { DialogOmniUpdate } from "../component/dialog-omni-update"
import { checkOnethyUpdate } from "../util/onethy-update"
import { useToast } from "../ui/toast"

type ClientNotice = { readonly type: "available" | "installed"; readonly version: string }
type Notice = ClientNotice & (
  | { readonly source: "client" }
  | { readonly source: "server"; readonly remote: boolean }
  | { readonly source: "onethy" }
)
export type UpdateState =
  | ClientNotice
  | { readonly type: "installing"; readonly version: string }
  | { readonly type: "failed"; readonly message: string }

export type UpdateSource = {
  readonly remote: boolean
  readonly subscribe: (notify: (notice: ClientNotice) => void) => () => void
  readonly check: (
    signal: AbortSignal,
    onInstall: (version: string) => void,
  ) => Promise<ClientNotice | { readonly type: "unavailable"; readonly message: string } | undefined>
  readonly apply: (version: string) => Promise<void>
}

export const { use: useUpdateNotification, provider: UpdateNotificationProvider } = createSimpleContext({
  name: "UpdateNotification",
  init: (props: { updater?: UpdateSource }) => {
    const event = useEvent()
    const exit = useExit()
    const epilogue = useEpilogue()
    const dialog = useDialog()
    const toast = useToast()
    const isOnethy = process.env.OMNICODE_ACTIVE === "1" || process.env.ONETHY_ACTIVE === "1"
    const log = useLog({ component: "update-notification" })
    const [state, setState] = createSignal<UpdateState>()
    const [notification, setNotification] = createSignal<Notice>()
    const [notifications, markNotification] = useStorage().store<{ versions: string[] }>("update-notifications", {
      initial: { versions: [] },
    })

    const notify = (notice: Notice) => {
      if (!props.updater && notice.source !== "onethy") return
      // Every way out of the TUI after a local install tells the user to start the new version.
      if (notice.type === "installed" && !(notice.source === "server" && notice.remote))
        epilogue.updatedVersion(notice.version)
      if (notice.source !== "onethy" && (
        notifications.versions.includes(`${notice.source}:${notice.version}`) ||
        (notice.source === "client" && notifications.versions.includes(notice.version))
      ))
        return
      setNotification((current) => {
        if (notice.source === "server" && current?.source === "client") return current
        return notice
      })
    }

    const dismiss = () => {
      const current = notification()
      if (!current) return
      setNotification(undefined)
      // The Onethy notice is refreshed on each launch if the update is still available.
      if (current.source === "onethy") return
      // Only interactions with the automatic notification update its history.
      void markNotification((draft) => {
        draft.versions = [...draft.versions, `${current.source}:${current.version}`].slice(-100)
      }).catch((error) => log.error("failed to persist update notification", { error }))
    }

    const install = async () => {
      const updater = props.updater
      const current = state()
      if (!updater || !current || current.type !== "available") return
      setState({ type: "installing", version: current.version })
      await updater.apply(current.version).then(
        () => {
          epilogue.updatedVersion(current.version)
          setState({ type: "installed", version: current.version })
        },
        (error) => setState({ type: "failed", message: errorMessage(error) }),
      )
    }

    const check = async (signal: AbortSignal) => {
      const updater = props.updater
      if (!updater || state()?.type === "installing") return
      const result = await updater
        .check(signal, (version) => {
          if (!signal.aborted) setState({ type: "installing", version })
        })
        .finally(() => {
          if (state()?.type === "installing") setState(undefined)
        })
      if (signal.aborted) return
      if (result?.type === "unavailable") return result.message
      if (result?.type === "installed") epilogue.updatedVersion(result.version)
      setState(result)
    }

    const restart = () => {
      const current = state()
      if (current?.type !== "installed") return
      exit()
    }

    const open = (origin: "manual" | "notification") => {
      if (notification()?.source === "onethy" || (!props.updater && isOnethy)) {
        dialog.replace(() => <DialogOmniUpdate />)
        return
      }
      if (!props.updater) return
      const current = notification()
      const known = current && (current.source === "client" || !current.remote) ? current : undefined
      if (origin === "notification" && !known) return
      const active = state()
      // The notification can predate an installation through /update.
      if (known && active?.type !== "installing" && !(active?.type === "installed" && active.version === known.version))
        setState({ type: known.type, version: known.version })
      const status = state()?.type
      dialog.replace(() => (
        <DialogUpdate
          check={status === undefined || status === "failed" ? check : undefined}
          state={state}
          skip={dismiss}
          install={install}
          restart={restart}
        />
      ))
    }

    onMount(() => {
      if (props.updater) onCleanup(props.updater.subscribe((notice) => notify({ ...notice, source: "client" })))
      if (!isOnethy) return

      let active = true
      let checking = false
      let lastAnnounced: string | undefined
      const poll = async () => {
        if (checking) return
        checking = true
        try {
          const update = await checkOnethyUpdate()
          if (!active) return
          if (!update) {
            setNotification((current) => current?.source === "onethy" ? undefined : current)
            return
          }
          const notice = { source: "onethy" as const, type: "available" as const, version: update.available }
          notify(notice)
          if (lastAnnounced === update.available) return
          lastAnnounced = update.available
          toast.show({
            variant: "info",
            title: "Atualização do Onethy Code disponível",
            message: `Nova versão ${update.available}. Digite /update para instalar.`,
            duration: 7000,
          })
        } catch (error) {
          log.error("OnethyCode update check failed", { error })
        } finally {
          checking = false
        }
      }
      void poll()
      const interval = setInterval(() => void poll(), 15 * 60 * 1000)
      onCleanup(() => { active = false; clearInterval(interval) })
    })

    onCleanup(
      event.on("installation.update-available", (event) =>
        notify({
          source: "server",
          remote: props.updater?.remote ?? false,
          type: "available",
          version: event.data.version,
        }),
      ),
    )
    onCleanup(
      event.on("installation.updated", (event) =>
        notify({
          source: "server",
          remote: props.updater?.remote ?? false,
          type: "installed",
          version: event.data.version,
        }),
      ),
    )

    return {
      notification,
      dismiss,
      open: props.updater || isOnethy ? open : undefined,
    }
  },
})
