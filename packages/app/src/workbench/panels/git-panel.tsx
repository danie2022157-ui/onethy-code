import { batch, createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js"
import type { LocationGetOutput, VcsFileStatus, VcsInfo, WorktreeDirectory } from "@opencode/client/promise"
import { FileIcon } from "@opencode/ui/file-icon"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { Tooltip } from "@opencode/ui/tooltip"
import { getDirectory, getFilename } from "@opencode/util/path"
import { useOnethyI18n } from "@/runtime/i18n/onethy"
import { ServerConnection } from "@/runtime/server/registry"
import { showToast } from "@/shell/notifications/toast"
import { useTabs } from "@/shell/tabs/tabs"
import { GitBranchIcon, SkillsSparkIcon } from "../icons"
import { useWorkbench, type ShellRunResult } from "../state"

export type GitFileChange = {
  path: string
  originalPath?: string
  code: string
  indexStatus: string
  worktreeStatus: string
  staged: boolean
  untracked: boolean
  conflicted: boolean
}

export type ParsedGitStatus = {
  staged: GitFileChange[]
  unstaged: GitFileChange[]
}

type ShellDialect = "posix" | "powershell" | "cmd"
type BusyAction =
  | "refresh"
  | "init"
  | "pull"
  | "push"
  | "commit"
  | "branch"
  | "stage"
  | "unstage"
  | "discard"
  | "worktree"

type WorktreeError = { kind: "invalid-branch" } | { kind: "raw"; message: string }

const CONFLICT_CODES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"])

/**
 * Parse `git status --porcelain=v1 -uall` output into separate staged and unstaged change lists.
 * Preserves leading whitespace on every line so unstaged entries (` M file`) are classified accurately.
 */
export function parseGitPorcelain(output: string): ParsedGitStatus {
  const staged: GitFileChange[] = []
  const unstaged: GitFileChange[] = []

  if (!output) return { staged, unstaged }

  const lines = output.replaceAll("\r\n", "\n").split("\n")

  for (const line of lines) {
    if (line.length < 4 || line[2] !== " ") continue

    const indexStatus = line[0]
    const worktreeStatus = line[1]
    const pair = `${indexStatus}${worktreeStatus}`

    if (pair === "!!") continue

    const rawRest = line.slice(3)
    const isRenameOrCopy =
      indexStatus === "R" || indexStatus === "C" || worktreeStatus === "R" || worktreeStatus === "C"
    const parsedPaths = isRenameOrCopy ? splitPorcelainRename(rawRest) : { path: unquoteGitPath(rawRest) }

    if (!parsedPaths.path) continue

    if (pair === "??") {
      unstaged.push({
        path: parsedPaths.path,
        code: "U",
        indexStatus: "?",
        worktreeStatus: "?",
        staged: false,
        untracked: true,
        conflicted: false,
      })
      continue
    }

    if (CONFLICT_CODES.has(pair)) {
      unstaged.push({
        path: parsedPaths.path,
        originalPath: parsedPaths.originalPath,
        code: "!",
        indexStatus,
        worktreeStatus,
        staged: false,
        untracked: false,
        conflicted: true,
      })
      continue
    }

    if (indexStatus !== " " && indexStatus !== "?") {
      staged.push({
        path: parsedPaths.path,
        originalPath: parsedPaths.originalPath,
        code: indexStatus,
        indexStatus,
        worktreeStatus,
        staged: true,
        untracked: false,
        conflicted: false,
      })
    }

    if (worktreeStatus !== " " && worktreeStatus !== "?") {
      unstaged.push({
        path: parsedPaths.path,
        originalPath: parsedPaths.originalPath,
        code: worktreeStatus,
        indexStatus,
        worktreeStatus,
        staged: false,
        untracked: false,
        conflicted: false,
      })
    }
  }

  return { staged, unstaged }
}

export function GitPanel() {
  const workbench = useWorkbench()
  const tabs = useTabs()
  const { tr } = useOnethyI18n()

  const [initialLoading, setInitialLoading] = createSignal(false)
  const [busyAction, setBusyAction] = createSignal<BusyAction | undefined>(undefined)
  const [vcsInfo, setVcsInfo] = createSignal<VcsInfo | undefined>(undefined)
  const [projectInfo, setProjectInfo] = createSignal<LocationGetOutput["project"] | undefined>(undefined)
  const [branches, setBranches] = createSignal<readonly string[]>([])
  const [vcsStatusRows, setVcsStatusRows] = createSignal<readonly VcsFileStatus[]>([])
  const [porcelain, setPorcelain] = createSignal<ParsedGitStatus>({ staged: [], unstaged: [] })
  const [worktrees, setWorktrees] = createSignal<readonly WorktreeDirectory[]>([])
  const [loadError, setLoadError] = createSignal<string | undefined>(undefined)

  const [branchMenuOpen, setBranchMenuOpen] = createSignal(false)
  const [branchInput, setBranchInput] = createSignal("")
  const [commitMessage, setCommitMessage] = createSignal("")

  const [stagedOpen, setStagedOpen] = createSignal(true)
  const [changesOpen, setChangesOpen] = createSignal(true)
  const [worktreesOpen, setWorktreesOpen] = createSignal(true)

  const [creatingWorktree, setCreatingWorktree] = createSignal(false)
  const [worktreeBranch, setWorktreeBranch] = createSignal("")
  const [worktreeName, setWorktreeName] = createSignal("")
  const [worktreeError, setWorktreeError] = createSignal<WorktreeError | undefined>(undefined)

  const [confirmDiscardPath, setConfirmDiscardPath] = createSignal<string | undefined>(undefined)
  const [confirmRemoveWorktree, setConfirmRemoveWorktree] = createSignal<string | undefined>(undefined)

  let branchInputRef: HTMLInputElement | undefined
  let worktreeBranchRef: HTMLInputElement | undefined
  let loadGeneration = 0
  let cachedDialectKey: string | undefined
  let cachedDialect: ShellDialect | undefined

  const isBusy = createMemo(() => busyAction() !== undefined)
  const hasGitRepo = createMemo(() => Boolean(vcsInfo()?.provider))
  const currentBranch = createMemo(() => vcsInfo()?.branch.current || vcsInfo()?.branch.default || "")

  const diffStatsByFile = createMemo(() => {
    const map = new Map<string, VcsFileStatus>()
    for (const row of vcsStatusRows()) {
      const normalized = normalizeRelativePath(row.file)
      if (!normalized) continue
      map.set(normalized, row)
    }
    return map
  })

  const filteredBranches = createMemo(() => {
    const query = branchInput().trim().toLowerCase()
    if (!query) return branches()
    return branches().filter((name) => name.toLowerCase().includes(query))
  })

  const exactBranchMatch = createMemo(() => {
    const candidate = branchInput().trim()
    if (!candidate) return false
    return branches().some((name) => name === candidate)
  })

  const totalChanges = createMemo(() => porcelain().staged.length + porcelain().unstaged.length)

  const worktreeErrorMessage = createMemo(() => {
    const current = worktreeError()
    if (!current) return undefined
    if (current.kind === "invalid-branch") return tr("Invalid branch name.", "Nome de branch inválido.")
    return current.message
  })

  const formatShellFailure = (result: ShellRunResult) => {
    if (result.error) return result.error
    const line = firstNonEmptyLine(result.output)
    if (line) return line
    return tr("Command exited with code {{code}}.", "Comando encerrado com código {{code}}.", {
      code: result.exit ?? tr("unknown", "desconhecido"),
    })
  }

  const changeCodeLabel = (code: string) => {
    if (code === "M") return tr("Modified", "Modificado")
    if (code === "A") return tr("Added", "Adicionado")
    if (code === "D") return tr("Deleted", "Removido")
    if (code === "R") return tr("Renamed", "Renomeado")
    if (code === "C") return tr("Copied", "Copiado")
    if (code === "!") return tr("Merge conflict", "Conflito de merge")
    return tr("Untracked", "Não rastreado")
  }

  // Auto-reset armed 2-click discard confirmation after 4 seconds.
  createEffect(() => {
    const armed = confirmDiscardPath()
    if (!armed) return
    const timer = setTimeout(() => setConfirmDiscardPath(undefined), 4000)
    onCleanup(() => clearTimeout(timer))
  })

  // Auto-reset armed 2-click worktree remove confirmation after 4 seconds.
  createEffect(() => {
    const armed = confirmRemoveWorktree()
    if (!armed) return
    const timer = setTimeout(() => setConfirmRemoveWorktree(undefined), 4000)
    onCleanup(() => clearTimeout(timer))
  })

  const resolveDialect = async (directory: string): Promise<ShellDialect> => {
    const ctx = workbench.activeServerCtx()
    const conn = workbench.activeServer()
    if (!ctx || !conn) return isWindowsPath(directory) ? "powershell" : "posix"

    const cacheKey = `${ServerConnection.key(conn)}::${directory}`
    if (cachedDialectKey === cacheKey && cachedDialect) return cachedDialect

    const entries = await ctx.sdk.api.config.get({ location: { directory } }).catch(() => [])
    const configured = entries
      .flatMap((entry) => (entry.type === "document" && entry.info.shell ? [entry.info.shell] : []))
      .at(-1)

    if (configured) {
      cachedDialectKey = cacheKey
      cachedDialect = dialectFromShellPath(configured)
      return cachedDialect
    }

    const shells = await ctx.sdk.api.config.shells().catch(() => [])
    const first = shells[0]
    const resolved = first
      ? dialectFromShellPath(first.path || first.name)
      : isWindowsPath(directory)
        ? "powershell"
        : "posix"

    cachedDialectKey = cacheKey
    cachedDialect = resolved
    return resolved
  }

  const loadGitState = async (opts?: { refreshWorktrees?: boolean; showSpinner?: boolean }) => {
    const ctx = workbench.activeServerCtx()
    const location = workbench.activeLocation()
    const dir = workbench.activeDirectory()

    if (!ctx || !location || !dir) return

    const generation = ++loadGeneration
    if (opts?.showSpinner) setInitialLoading(true)

    const [vcsRes, locRes] = await Promise.all([
      ctx.sdk.api.vcs
        .get({ location })
        .then((res) => ({ ok: true as const, data: res.data }))
        .catch((err) => ({ ok: false as const, message: errorMessage(err) })),
      ctx.sdk.api.location.get({ location }).catch(() => undefined),
    ])

    if (generation !== loadGeneration) return

    if (!vcsRes.ok) {
      batch(() => {
        setInitialLoading(false)
        setVcsInfo(undefined)
        setProjectInfo(locRes?.project)
        setLoadError(vcsRes.message)
      })
      return
    }

    const info = vcsRes.data
    const project = locRes?.project

    if (!info.provider) {
      batch(() => {
        setInitialLoading(false)
        setVcsInfo(info)
        setProjectInfo(project)
        setBranches([])
        setVcsStatusRows([])
        setPorcelain({ staged: [], unstaged: [] })
        setWorktrees([])
        setLoadError(undefined)
      })
      return
    }

    if (opts?.refreshWorktrees && project?.id) {
      await ctx.sdk.api.worktree.refresh({ projectID: project.id }).catch(() => undefined)
      if (generation !== loadGeneration) return
    }

    const [statusRes, branchRes, porcelainRes, worktreeRes] = await Promise.all([
      ctx.sdk.api.vcs.status({ location }).catch(() => undefined),
      ctx.sdk.api.vcs.branch.list({ location, limit: 100 }).catch(() => undefined),
      workbench.runShellCommand("git -c core.quotepath=false status --porcelain=v1 -uall", {
        cwd: dir,
        timeout: 15_000,
      }),
      project?.id ? ctx.sdk.api.worktree.list({ projectID: project.id }).catch(() => []) : Promise.resolve([]),
    ])

    if (generation !== loadGeneration) return

    const parsed = porcelainRes.exit === 0 ? parseGitPorcelain(porcelainRes.output) : { staged: [], unstaged: [] }
    const porcelainError =
      porcelainRes.exit === 0
        ? undefined
        : porcelainRes.error || firstNonEmptyLine(porcelainRes.output) || undefined

    batch(() => {
      setInitialLoading(false)
      setVcsInfo(info)
      setProjectInfo(project)
      setVcsStatusRows(statusRes?.data ?? [])
      setBranches(branchRes?.data ?? [])
      setPorcelain(parsed)
      setWorktrees(worktreeRes ?? [])
      setLoadError(porcelainError)
    })
  }

  // Reset transient UI state when switching active server or directory.
  createEffect(() => {
    workbench.activeServerCtx()
    workbench.activeDirectory()
    cachedDialectKey = undefined
    cachedDialect = undefined

    batch(() => {
      setVcsInfo(undefined)
      setProjectInfo(undefined)
      setBranchMenuOpen(false)
      setBranchInput("")
      setCreatingWorktree(false)
      setWorktreeBranch("")
      setWorktreeName("")
      setWorktreeError(undefined)
      setConfirmDiscardPath(undefined)
      setConfirmRemoveWorktree(undefined)
      setLoadError(undefined)
    })
  })

  // Reload git status & worktrees when workspace changes or gitRevision bumps.
  createEffect(() => {
    const ctx = workbench.activeServerCtx()
    const location = workbench.activeLocation()
    workbench.gitRevision()

    if (!ctx || !location) {
      loadGeneration += 1
      batch(() => {
        setInitialLoading(false)
        setVcsInfo(undefined)
        setProjectInfo(undefined)
        setBranches([])
        setVcsStatusRows([])
        setPorcelain({ staged: [], unstaged: [] })
        setWorktrees([])
      })
      return
    }

    void untrack(() => loadGitState({ showSpinner: !vcsInfo() }))
  })

  const runGitMutation = async (
    action: BusyAction,
    command: string,
    messages: { successTitle: string; successDescription?: string; errorTitle: string },
  ) => {
    const dir = workbench.activeDirectory()
    if (!dir || isBusy()) return false

    setBusyAction(action)
    const result = await workbench.runShellCommand(command, { cwd: dir, timeout: 60_000 })
    setBusyAction(undefined)

    if (!isShellSuccess(result)) {
      showToast({
        variant: "error",
        title: messages.errorTitle,
        description: formatShellFailure(result),
      })
      return false
    }

    showToast({
      variant: "success",
      title: messages.successTitle,
      description: messages.successDescription,
    })
    workbench.bumpGitRevision()
    return true
  }

  const handleInitRepo = async () => {
    const ctx = workbench.activeServerCtx()
    const location = workbench.activeLocation()
    if (!ctx || !location || isBusy()) return

    setBusyAction("init")
    const outcome = await ctx.sdk.api.vcs
      .init({ location, provider: "git" })
      .then(() => ({ ok: true as const }))
      .catch((err) => ({ ok: false as const, message: errorMessage(err) }))
    setBusyAction(undefined)

    if (!outcome.ok) {
      showToast({
        variant: "error",
        title: tr("Failed to initialize Git repository", "Falha ao inicializar repositório Git"),
        description: outcome.message,
      })
      return
    }

    showToast({
      variant: "success",
      title: tr("Git repository initialized", "Repositório Git inicializado"),
    })
    workbench.bumpGitRevision()
  }

  const handleRefresh = async () => {
    if (isBusy()) return
    setBusyAction("refresh")
    await loadGitState({ refreshWorktrees: true })
    setBusyAction(undefined)
  }

  const handlePull = async () => {
    await runGitMutation("pull", "git pull", {
      successTitle: tr("Git Pull completed", "Git Pull concluído"),
      errorTitle: tr("Git Pull failed", "Falha no Git Pull"),
    })
  }

  const handlePush = async () => {
    await runGitMutation("push", "git push", {
      successTitle: tr("Git Push completed", "Git Push concluído"),
      errorTitle: tr("Git Push failed", "Falha no Git Push"),
    })
  }

  const handleToggleBranchMenu = () => {
    const next = !branchMenuOpen()
    setBranchMenuOpen(next)
    setBranchInput("")
    if (next) {
      queueMicrotask(() => branchInputRef?.focus())
    }
  }

  const handleSwitchBranch = async (branchName: string) => {
    const dir = workbench.activeDirectory()
    if (!dir || isBusy() || branchName === currentBranch()) {
      setBranchMenuOpen(false)
      return
    }

    const dialect = await resolveDialect(dir)
    const ok = await runGitMutation("branch", `git checkout ${quoteShellArg(branchName, dialect)}`, {
      successTitle: tr("Branch switched", "Branch alterada"),
      successDescription: branchName,
      errorTitle: tr("Failed to switch branch", "Falha ao trocar de branch"),
    })

    if (ok) {
      setBranchMenuOpen(false)
      setBranchInput("")
    }
  }

  const handleCreateBranch = async (event?: SubmitEvent) => {
    event?.preventDefault()
    const dir = workbench.activeDirectory()
    const candidate = branchInput().trim()

    if (!dir || isBusy() || !candidate) return

    if (!isValidBranchName(candidate)) {
      showToast({
        variant: "error",
        title: tr("Invalid branch name", "Nome de branch inválido"),
        description: tr(
          "Avoid spaces, leading '-', or Git reserved characters.",
          "Evite espaços, iniciar com '-' ou caracteres reservados do Git.",
        ),
      })
      return
    }

    const dialect = await resolveDialect(dir)
    const ok = await runGitMutation("branch", `git checkout -b ${quoteShellArg(candidate, dialect)}`, {
      successTitle: tr("Branch created", "Branch criada"),
      successDescription: candidate,
      errorTitle: tr("Failed to create branch", "Falha ao criar branch"),
    })

    if (ok) {
      setBranchMenuOpen(false)
      setBranchInput("")
    }
  }

  const handleCommit = async () => {
    const dir = workbench.activeDirectory()
    const message = commitMessage().trim()

    if (!dir || isBusy()) return

    if (porcelain().staged.length === 0) {
      showToast({
        variant: "default",
        title: tr("No staged changes", "Nenhuma alteração preparada"),
        description: tr(
          "Stage at least one file before committing.",
          "Prepare ao menos um arquivo antes de confirmar o commit.",
        ),
      })
      return
    }

    if (!message) {
      showToast({
        variant: "default",
        title: tr("Enter a commit message", "Informe a mensagem do commit"),
      })
      return
    }

    const dialect = await resolveDialect(dir)
    const command = buildSafeCommitCommand(message, dialect)

    const ok = await runGitMutation("commit", command, {
      successTitle: tr("Commit created successfully", "Commit criado com sucesso"),
      successDescription: firstNonEmptyLine(message),
      errorTitle: tr("Failed to create commit", "Falha ao criar commit"),
    })

    if (ok) {
      setCommitMessage("")
    }
  }

  const handleGenerateWithAI = () => {
    const stagedFiles = porcelain().staged.map((item) => item.path)
    const unstagedFiles = porcelain().unstaged.map((item) => item.path)
    const files = stagedFiles.length > 0 ? stagedFiles : unstagedFiles

    const scopeHint =
      files.length > 0
        ? tr(
            " Consider the changed files: {{files}}{{extra}}.",
            " Considere os arquivos alterados: {{files}}{{extra}}.",
            {
              files: files.slice(0, 12).join(", "),
              extra: files.length > 12 ? ` (+${files.length - 12})` : "",
            },
          )
        : ""

    const target =
      stagedFiles.length > 0
        ? tr("the staged changes (git diff --cached)", "as alterações preparadas (git diff --cached)")
        : tr("the current changes (git diff)", "as alterações atuais (git diff)")
    const prompt = tr(
      "Analyze {{target}} and generate a clear, concise commit message following Conventional Commits (type(scope): summary).{{scopeHint}}",
      "Analise {{target}} e gere uma mensagem de commit clara e concisa no padrão Conventional Commits (type(scope): summary).{{scopeHint}}",
      { target, scopeHint },
    )

    workbench.insertComposerText(prompt)
    showToast({
      variant: "default",
      title: tr("Prompt inserted into composer", "Prompt inserido no composer"),
      description: tr(
        "Send the message in chat to generate the commit with AI.",
        "Envie a mensagem no chat para gerar o commit com IA.",
      ),
    })
  }

  const handleStageFile = async (event: MouseEvent, filePath: string) => {
    event.stopPropagation()
    const dir = workbench.activeDirectory()
    if (!dir || isBusy()) return

    const dialect = await resolveDialect(dir)
    const sep = doubleDashArg(dialect)

    setBusyAction("stage")
    const result = await workbench.runShellCommand(`git add ${sep} ${quoteShellArg(filePath, dialect)}`, {
      cwd: dir,
      timeout: 15_000,
    })
    setBusyAction(undefined)

    if (!isShellSuccess(result)) {
      showToast({
        variant: "error",
        title: tr("Failed to stage file", "Falha ao preparar arquivo"),
        description: formatShellFailure(result),
      })
      return
    }

    setConfirmDiscardPath(undefined)
    workbench.bumpGitRevision()
  }

  const handleStageAll = async (event: MouseEvent) => {
    event.stopPropagation()
    if (porcelain().unstaged.length === 0) return

    await runGitMutation("stage", "git add -A", {
      successTitle: tr("All changes staged", "Todas as alterações foram preparadas"),
      errorTitle: tr("Failed to stage changes", "Falha ao preparar alterações"),
    })
    setConfirmDiscardPath(undefined)
  }

  const handleUnstageFile = async (event: MouseEvent, filePath: string) => {
    event.stopPropagation()
    const dir = workbench.activeDirectory()
    if (!dir || isBusy()) return

    const dialect = await resolveDialect(dir)
    const sep = doubleDashArg(dialect)
    const quoted = quoteShellArg(filePath, dialect)

    setBusyAction("unstage")
    const firstTry = await workbench.runShellCommand(`git reset HEAD ${sep} ${quoted}`, {
      cwd: dir,
      timeout: 15_000,
    })

    // Unborn repositories (no commits yet) reject `git reset HEAD`; unstage from index via `git rm --cached`.
    const finalResult =
      !isShellSuccess(firstTry) && isUnbornHeadError(firstTry.output)
        ? await workbench.runShellCommand(`git rm --cached --quiet ${sep} ${quoted}`, {
            cwd: dir,
            timeout: 15_000,
          })
        : firstTry

    setBusyAction(undefined)

    if (!isShellSuccess(finalResult)) {
      showToast({
        variant: "error",
        title: tr("Failed to unstage file", "Falha ao despreparar arquivo"),
        description: formatShellFailure(finalResult),
      })
      return
    }

    workbench.bumpGitRevision()
  }

  const handleUnstageAll = async (event: MouseEvent) => {
    event.stopPropagation()
    const dir = workbench.activeDirectory()
    if (!dir || isBusy() || porcelain().staged.length === 0) return

    setBusyAction("unstage")
    const firstTry = await workbench.runShellCommand("git reset HEAD", {
      cwd: dir,
      timeout: 15_000,
    })

    const dialect = await resolveDialect(dir)
    const sep = doubleDashArg(dialect)

    const finalResult =
      !isShellSuccess(firstTry) && isUnbornHeadError(firstTry.output)
        ? await workbench.runShellCommand(`git rm -r --cached --quiet ${sep} .`, {
            cwd: dir,
            timeout: 15_000,
          })
        : firstTry

    setBusyAction(undefined)

    if (!isShellSuccess(finalResult)) {
      showToast({
        variant: "error",
        title: tr("Failed to unstage changes", "Falha ao despreparar alterações"),
        description: formatShellFailure(finalResult),
      })
      return
    }

    showToast({
      variant: "success",
      title: tr("All changes unstaged", "Todas as alterações foram despreparadas"),
    })
    workbench.bumpGitRevision()
  }

  const handleDiscardClick = async (event: MouseEvent, entry: GitFileChange) => {
    event.stopPropagation()
    const dir = workbench.activeDirectory()
    if (!dir || isBusy()) return

    if (confirmDiscardPath() !== entry.path) {
      setConfirmDiscardPath(entry.path)
      return
    }

    setConfirmDiscardPath(undefined)
    const dialect = await resolveDialect(dir)
    const sep = doubleDashArg(dialect)
    const quoted = quoteShellArg(entry.path, dialect)
    const command = entry.untracked ? `git clean -fd ${sep} ${quoted}` : `git checkout ${sep} ${quoted}`

    await runGitMutation("discard", command, {
      successTitle: tr("Change discarded", "Alteração descartada"),
      successDescription: entry.path,
      errorTitle: tr("Failed to discard change", "Falha ao descartar alteração"),
    })
  }

  const handleOpenFile = (event: MouseEvent, filePath: string) => {
    event.stopPropagation()
    void workbench.openFile(filePath, { edit: true })
  }

  const handleRefreshWorktrees = async (event: MouseEvent) => {
    event.stopPropagation()
    const ctx = workbench.activeServerCtx()
    const project = projectInfo()
    if (!ctx || !project || isBusy()) return

    setBusyAction("worktree")
    await ctx.sdk.api.worktree.refresh({ projectID: project.id }).catch(() => undefined)
    const listed = await ctx.sdk.api.worktree.list({ projectID: project.id }).catch(() => undefined)
    setBusyAction(undefined)

    if (listed) {
      setWorktrees(listed)
    }
  }

  const handleToggleCreateWorktree = (event: MouseEvent) => {
    event.stopPropagation()
    const next = !creatingWorktree()
    batch(() => {
      setCreatingWorktree(next)
      setWorktreeError(undefined)
      if (!next) {
        setWorktreeBranch("")
        setWorktreeName("")
      }
      if (next) {
        setWorktreesOpen(true)
      }
    })
    if (next) {
      queueMicrotask(() => worktreeBranchRef?.focus())
    }
  }

  const handleCreateWorktree = async (event: SubmitEvent) => {
    event.preventDefault()
    const ctx = workbench.activeServerCtx()
    const project = projectInfo()
    if (!ctx || !project || isBusy()) return

    const branch = worktreeBranch().trim() || undefined
    const name = worktreeName().trim() || undefined

    if (branch && !isValidBranchName(branch)) {
      setWorktreeError({ kind: "invalid-branch" })
      return
    }

    setBusyAction("worktree")
    setWorktreeError(undefined)

    const outcome = await ctx.sdk.api.worktree
      .create({
        projectID: project.id,
        from: project.canonical,
        branch,
        name,
      })
      .then((created) => ({ ok: true as const, created }))
      .catch((err) => ({ ok: false as const, message: errorMessage(err) }))

    if (!outcome.ok) {
      setBusyAction(undefined)
      setWorktreeError({ kind: "raw", message: outcome.message })
      return
    }

    await ctx.data.location.syncInfo({ directory: outcome.created.directory }).catch(() => undefined)
    const listed = await ctx.sdk.api.worktree.list({ projectID: project.id }).catch(() => undefined)
    setBusyAction(undefined)

    batch(() => {
      setCreatingWorktree(false)
      setWorktreeBranch("")
      setWorktreeName("")
      setWorktreeError(undefined)
      if (listed) setWorktrees(listed)
    })

    showToast({
      variant: "success",
      title: tr("Worktree created", "Worktree criado"),
      description: getFilename(outcome.created.directory) || outcome.created.directory,
    })
    workbench.bumpGitRevision()
  }

  const handleOpenWorktreeDraft = async (event: MouseEvent, directory: string) => {
    event.stopPropagation()
    const conn = workbench.activeServer()
    const ctx = workbench.activeServerCtx()
    if (!conn || !ctx) return

    await ctx.data.location.syncInfo({ directory }).catch(() => undefined)
    await tabs.newDraft({ server: ServerConnection.key(conn), directory }, "")
  }

  const handleRemoveWorktree = async (event: MouseEvent, directory: string) => {
    event.stopPropagation()
    const ctx = workbench.activeServerCtx()
    const project = projectInfo()
    if (!ctx || !project || isBusy()) return

    if (confirmRemoveWorktree() !== directory) {
      setConfirmRemoveWorktree(directory)
      return
    }

    setConfirmRemoveWorktree(undefined)
    setBusyAction("worktree")

    const outcome = await ctx.sdk.api.worktree
      .remove({ projectID: project.id, directory, force: false })
      .then(() => ({ ok: true as const }))
      .catch((err) => ({ ok: false as const, message: errorMessage(err) }))

    if (!outcome.ok) {
      setBusyAction(undefined)
      showToast({
        variant: "error",
        title: tr("Failed to remove worktree", "Falha ao remover worktree"),
        description: outcome.message,
      })
      return
    }

    const listed = await ctx.sdk.api.worktree.list({ projectID: project.id }).catch(() => undefined)
    setBusyAction(undefined)

    if (listed) setWorktrees(listed)

    showToast({
      variant: "success",
      title: tr("Worktree removed", "Worktree removido"),
      description: getFilename(directory) || directory,
    })
    workbench.bumpGitRevision()
  }

  const renderChangeRow = (entry: GitFileChange) => {
    const name = getFilename(entry.path) || entry.path
    const parent = parentDirectory(entry.path)
    const stats = () => diffStatsByFile().get(entry.path)
    const isDiscardArmed = () => !entry.staged && confirmDiscardPath() === entry.path
    const fullTitle = entry.originalPath ? `${entry.originalPath} -> ${entry.path}` : entry.path

    return (
      <div
        role="button"
        tabIndex={0}
        title={fullTitle}
        class="group/row flex h-[27px] cursor-pointer items-center gap-1.5 px-2.5 text-[12px] select-none transition-colors hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-1 focus-visible:outline-v2-border-border-focus"
        onClick={() => workbench.openDiff(entry.path)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return
          e.preventDefault()
          workbench.openDiff(entry.path)
        }}
      >
        <FileIcon node={{ path: entry.path, type: "file" }} class="size-4 shrink-0" />

        <div class="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
          <span
            class={`shrink-0 truncate ${changeToneClass(entry.code)}`}
            classList={{ "line-through": entry.code === "D" }}
          >
            {name}
          </span>
          <Show when={parent}>
            <span class="min-w-0 truncate text-[10.5px] text-v2-text-text-faint">{parent}</span>
          </Show>
        </div>

        {/* Diff +/- counts enriched from vcs.status */}
        <Show when={stats() && ((stats()?.additions ?? 0) > 0 || (stats()?.deletions ?? 0) > 0)}>
          <div class="flex shrink-0 items-center gap-1 font-mono text-[10px] leading-none tabular-nums group-hover/row:hidden">
            <Show when={(stats()?.additions ?? 0) > 0}>
              <span class="text-v2-state-fg-success">+{stats()?.additions}</span>
            </Show>
            <Show when={(stats()?.deletions ?? 0) > 0}>
              <span class="text-v2-state-fg-danger">-{stats()?.deletions}</span>
            </Show>
          </div>
        </Show>

        {/* Row hover action buttons */}
        <div
          class="flex shrink-0 items-center gap-0.5 transition-opacity duration-100"
          classList={{
            "opacity-100": isDiscardArmed(),
            "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100": !isDiscardArmed(),
          }}
        >
          <Tooltip placement="top" value={tr("Open file", "Abrir arquivo")}>
            <button
              type="button"
              class="flex size-5 items-center justify-center rounded-[4px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
              aria-label={tr("Open {{path}}", "Abrir {{path}}", { path: entry.path })}
              onClick={(e) => handleOpenFile(e, entry.path)}
            >
              <Icon name="open-file" size="small" class="size-3.5" />
            </button>
          </Tooltip>

          <Show when={entry.staged}>
            <Tooltip placement="top" value={tr("Unstage file", "Despreparar arquivo")}>
              <button
                type="button"
                disabled={isBusy()}
                class="flex size-5 items-center justify-center rounded-[4px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-40"
                aria-label={tr("Unstage {{path}}", "Despreparar {{path}}", { path: entry.path })}
                onClick={(e) => void handleUnstageFile(e, entry.path)}
              >
                <Icon name="minus" size="small" class="size-3.5" />
              </button>
            </Tooltip>
          </Show>

          <Show when={!entry.staged}>
            <Tooltip
              placement="top"
              value={
                isDiscardArmed()
                  ? tr("Click again to confirm discard", "Clique novamente para confirmar descarte")
                  : tr("Discard change", "Descartar alteração")
              }
            >
              <button
                type="button"
                disabled={isBusy()}
                class="flex size-5 items-center justify-center rounded-[4px] transition-colors disabled:opacity-40"
                classList={{
                  "bg-v2-state-bg-danger text-v2-state-fg-danger": isDiscardArmed(),
                  "text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-state-fg-danger":
                    !isDiscardArmed(),
                }}
                aria-label={
                  isDiscardArmed()
                    ? tr("Confirm discarding {{path}}", "Confirmar descarte de {{path}}", { path: entry.path })
                    : tr("Discard changes in {{path}}", "Descartar alterações de {{path}}", { path: entry.path })
                }
                onClick={(e) => void handleDiscardClick(e, entry)}
              >
                <Show when={isDiscardArmed()} fallback={<Icon name="outline-undo" size="small" class="size-3.5" />}>
                  <Icon name="outline-hexagonal-warning" size="small" class="size-3.5" />
                </Show>
              </button>
            </Tooltip>

            <Tooltip placement="top" value={tr("Stage file", "Preparar arquivo")}>
              <button
                type="button"
                disabled={isBusy()}
                class="flex size-5 items-center justify-center rounded-[4px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-40"
                aria-label={tr("Stage {{path}}", "Preparar {{path}}", { path: entry.path })}
                onClick={(e) => void handleStageFile(e, entry.path)}
              >
                <Icon name="plus" size="small" class="size-3.5" />
              </button>
            </Tooltip>
          </Show>
        </div>

        <span
          class={`w-3 shrink-0 text-center font-mono text-[10.5px] font-semibold leading-none ${changeToneClass(entry.code)}`}
          title={changeCodeLabel(entry.code)}
          aria-label={changeCodeLabel(entry.code)}
        >
          {entry.code}
        </span>
      </div>
    )
  }

  return (
    <Show
      when={workbench.activeServerCtx() && workbench.activeDirectory()}
      fallback={
        <div class="flex flex-1 flex-col items-center justify-center gap-2.5 px-5 py-8 text-center">
          <div class="flex size-10 items-center justify-center rounded-xl border border-v2-border-border-muted bg-v2-background-bg-layer-01 text-v2-icon-icon-muted">
            <GitBranchIcon size={18} />
          </div>
          <div class="text-[12.5px] font-medium text-v2-text-text-base">
            {tr("No open project", "Nenhum projeto aberto")}
          </div>
          <p class="max-w-[210px] text-[11.5px] leading-4 text-v2-text-text-faint">
            {tr(
              "Open a directory or session to manage Git branches, commits, and worktrees.",
              "Abra um diretório ou sessão para gerenciar branches, commits e worktrees Git.",
            )}
          </p>
        </div>
      }
    >
      <Show
        when={!initialLoading()}
        fallback={
          <div class="flex flex-1 items-center justify-center gap-2 py-8 text-[12px] text-v2-text-text-faint">
            <Loader width={14} height={14} />
            <span>{tr("Loading Git status...", "Carregando status do Git...")}</span>
          </div>
        }
      >
        <Show
          when={hasGitRepo()}
          fallback={
            <div class="flex flex-1 flex-col items-center justify-center gap-3 px-5 py-8 text-center">
              <div class="flex size-10 items-center justify-center rounded-xl border border-v2-border-border-muted bg-v2-background-bg-layer-01 text-v2-icon-icon-muted">
                <GitBranchIcon size={18} />
              </div>
              <div class="space-y-1">
                <div class="text-[12.5px] font-medium text-v2-text-text-base">
                  {tr("Git repository not found", "Repositório Git não encontrado")}
                </div>
                <p class="max-w-[220px] text-[11.5px] leading-4 text-v2-text-text-faint">
                  {tr(
                    "This workspace does not have Git version control initialized yet.",
                    "Este workspace ainda não possui controle de versão Git inicializado.",
                  )}
                </p>
              </div>
              <button
                type="button"
                disabled={isBusy()}
                class="inline-flex h-8 items-center justify-center gap-1.5 rounded-[6px] bg-v2-background-bg-accent px-3 text-[12px] font-medium text-v2-text-text-inverse transition-opacity hover:opacity-90 disabled:opacity-50"
                onClick={() => void handleInitRepo()}
              >
                <Show when={busyAction() === "init"} fallback={<GitBranchIcon size={14} />}>
                  <Loader width={13} height={13} />
                </Show>
                <span>{tr("Initialize Git Repository", "Inicializar Repositório Git")}</span>
              </button>
              <Show when={loadError()}>
                {(message) => <div class="max-w-[230px] text-[11px] text-v2-state-fg-danger">{message()}</div>}
              </Show>
            </div>
          }
        >
          <div class="flex min-h-0 flex-1 flex-col bg-v2-background-bg-base text-v2-text-text-base">
            {/* Branch header & sync controls */}
            <div class="flex shrink-0 items-center justify-between gap-1.5 border-b border-v2-border-border-muted px-2 py-1.5">
              <button
                type="button"
                aria-expanded={branchMenuOpen()}
                title={
                  currentBranch()
                    ? tr("Current branch: {{branch}}", "Branch atual: {{branch}}", { branch: currentBranch() })
                    : tr("Switch or create branch", "Alternar ou criar branch")
                }
                class="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-[5px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 px-2 text-left text-[11.5px] font-medium text-v2-text-text-base transition-colors hover:bg-v2-overlay-simple-overlay-hover"
                onClick={handleToggleBranchMenu}
              >
                <GitBranchIcon size={13} class="shrink-0 text-v2-text-text-accent" />
                <span class="min-w-0 flex-1 truncate">{currentBranch() || tr("Detached HEAD", "HEAD destacado")}</span>
                <Icon
                  name="chevron-down"
                  size="small"
                  class="size-3 shrink-0 text-v2-icon-icon-muted transition-transform duration-150"
                  classList={{ "rotate-180": branchMenuOpen() }}
                />
              </button>

              <div class="flex shrink-0 items-center gap-0.5">
                <Tooltip placement="bottom" value="Git Pull">
                  <button
                    type="button"
                    disabled={isBusy()}
                    aria-label={tr("Run Git Pull", "Executar Git Pull")}
                    class="flex size-6 items-center justify-center rounded-[5px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-45"
                    onClick={() => void handlePull()}
                  >
                    <Show when={busyAction() === "pull"} fallback={<GitPullIcon />}>
                      <Loader width={12} height={12} />
                    </Show>
                  </button>
                </Tooltip>

                <Tooltip placement="bottom" value="Git Push">
                  <button
                    type="button"
                    disabled={isBusy()}
                    aria-label={tr("Run Git Push", "Executar Git Push")}
                    class="flex size-6 items-center justify-center rounded-[5px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-45"
                    onClick={() => void handlePush()}
                  >
                    <Show when={busyAction() === "push"} fallback={<GitPushIcon />}>
                      <Loader width={12} height={12} />
                    </Show>
                  </button>
                </Tooltip>

                <Tooltip placement="bottom" value={tr("Refresh", "Atualizar")}>
                  <button
                    type="button"
                    disabled={isBusy()}
                    aria-label={tr("Refresh Git status", "Atualizar status Git")}
                    class="flex size-6 items-center justify-center rounded-[5px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-45"
                    onClick={() => void handleRefresh()}
                  >
                    <Show
                      when={busyAction() === "refresh"}
                      fallback={<Icon name="refresh" size="small" class="size-3.5" />}
                    >
                      <Loader width={12} height={12} />
                    </Show>
                  </button>
                </Tooltip>
              </div>
            </div>

            {/* Inline branch switcher / creator */}
            <Show when={branchMenuOpen()}>
              <div class="shrink-0 border-b border-v2-border-border-muted bg-v2-background-bg-layer-01 px-2 py-2">
                <form class="flex items-center gap-1" onSubmit={(e) => void handleCreateBranch(e)}>
                  <input
                    ref={branchInputRef}
                    type="text"
                    value={branchInput()}
                    disabled={isBusy()}
                    placeholder={tr("Filter or create branch...", "Filtrar ou criar branch...")}
                    aria-label={tr("Filter or create branch", "Filtrar ou criar branch")}
                    class="h-7 min-w-0 flex-1 rounded-[5px] border border-v2-border-border-base bg-v2-background-bg-deep px-2 text-[11.5px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint focus:border-v2-border-border-focus"
                    onInput={(e) => setBranchInput(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.stopPropagation()
                        setBranchMenuOpen(false)
                      }
                    }}
                  />
                  <Show when={branchInput().trim().length > 0 && !exactBranchMatch()}>
                    <Tooltip
                      placement="bottom"
                      value={tr('Create branch "{{branch}}"', 'Criar branch "{{branch}}"', {
                        branch: branchInput().trim(),
                      })}
                    >
                      <button
                        type="submit"
                        disabled={isBusy()}
                        class="flex h-7 shrink-0 items-center gap-1 rounded-[5px] bg-v2-background-bg-accent px-2 text-[11px] font-medium text-v2-text-text-inverse hover:opacity-90 disabled:opacity-50"
                      >
                        <Icon name="plus" size="small" class="size-3" />
                        <span>{tr("Create", "Criar")}</span>
                      </button>
                    </Tooltip>
                  </Show>
                </form>

                <div class="mt-1.5 max-h-36 overflow-y-auto">
                  <Show
                    when={filteredBranches().length > 0}
                    fallback={
                      <div class="px-2 py-1.5 text-[11px] text-v2-text-text-faint">
                        {tr(
                          "No branch found. Press Enter to create.",
                          "Nenhuma branch encontrada. Pressione Enter para criar.",
                        )}
                      </div>
                    }
                  >
                    <For each={filteredBranches()}>
                      {(branchName) => {
                        const isCurrent = () => branchName === currentBranch()
                        return (
                          <button
                            type="button"
                            disabled={isBusy()}
                            class="flex h-6 w-full items-center gap-1.5 rounded-[4px] px-2 text-left text-[11.5px] transition-colors hover:bg-v2-overlay-simple-overlay-hover disabled:opacity-50"
                            classList={{
                              "bg-v2-overlay-simple-overlay-pressed font-medium text-v2-text-text-base": isCurrent(),
                              "text-v2-text-text-muted": !isCurrent(),
                            }}
                            onClick={() => void handleSwitchBranch(branchName)}
                          >
                            <GitBranchIcon size={12} class="shrink-0 opacity-75" />
                            <span class="min-w-0 flex-1 truncate">{branchName}</span>
                            <Show when={isCurrent()}>
                              <Icon name="check" size="small" class="size-3 shrink-0 text-v2-text-text-accent" />
                            </Show>
                          </button>
                        )
                      }}
                    </For>
                  </Show>
                </div>
              </div>
            </Show>

            {/* Commit box */}
            <div class="shrink-0 border-b border-v2-border-border-muted px-2 py-2">
              <textarea
                rows={3}
                value={commitMessage()}
                disabled={isBusy()}
                placeholder={tr(
                  "Commit message (Ctrl+Enter to commit)...",
                  "Mensagem do commit (Ctrl+Enter para confirmar)...",
                )}
                aria-label={tr("Commit message", "Mensagem do commit")}
                class="w-full resize-none rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-deep px-2 py-1.5 text-[12px] leading-4 text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint focus:border-v2-border-border-focus disabled:opacity-60"
                onInput={(e) => setCommitMessage(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                    e.preventDefault()
                    void handleCommit()
                  }
                }}
              />

              <div class="mt-1.5 flex items-center gap-1.5">
                <Tooltip
                  placement="bottom"
                  value={
                    porcelain().staged.length === 0
                      ? tr(
                          "Stage at least one file before committing",
                          "Prepare ao menos um arquivo antes de confirmar o commit",
                        )
                      : tr("Commit staged changes", "Confirmar commit das alterações preparadas")
                  }
                >
                  <button
                    type="button"
                    disabled={isBusy() || !commitMessage().trim() || porcelain().staged.length === 0}
                    class="flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[5px] bg-v2-background-bg-accent px-2.5 text-[11.5px] font-medium text-v2-text-text-inverse transition-opacity hover:opacity-90 disabled:opacity-45"
                    onClick={() => void handleCommit()}
                  >
                    <Show when={busyAction() === "commit"} fallback={<Icon name="check" size="small" class="size-3.5" />}>
                      <Loader width={12} height={12} />
                    </Show>
                    <span class="truncate">
                      {porcelain().staged.length > 0 ? `Commit (${porcelain().staged.length})` : "Commit"}
                    </span>
                  </button>
                </Tooltip>

                <Tooltip
                  placement="bottom"
                  value={tr(
                    "Insert prompt in composer to generate commit message with AI",
                    "Inserir prompt no composer para gerar mensagem de commit com IA",
                  )}
                >
                  <button
                    type="button"
                    disabled={isBusy()}
                    class="flex h-7 shrink-0 items-center justify-center gap-1 rounded-[5px] border border-v2-border-border-base bg-v2-background-bg-layer-01 px-2 text-[11.5px] font-medium text-v2-text-text-base transition-colors hover:bg-v2-overlay-simple-overlay-hover disabled:opacity-45"
                    onClick={handleGenerateWithAI}
                  >
                    <SkillsSparkIcon size={13} class="text-v2-text-text-accent" />
                    <span>{tr("Generate with AI", "Gerar com IA")}</span>
                  </button>
                </Tooltip>
              </div>
            </div>

            {/* Scrollable lists: Staged, Changes, Worktrees */}
            <div data-slot="workbench-scroll" class="min-h-0 flex-1 overflow-y-auto py-1">
              <Show when={loadError()}>
                {(message) => (
                  <div class="mx-2 my-1 rounded-md border border-v2-state-border-danger bg-v2-state-bg-danger px-2.5 py-1.5 text-[11px] text-v2-state-fg-danger">
                    {message()}
                  </div>
                )}
              </Show>

              {/* Staged changes section */}
              <div class="mb-1">
                <div class="flex h-6.5 items-center justify-between gap-1 px-2 hover:bg-v2-overlay-simple-overlay-hover">
                  <button
                    type="button"
                    aria-expanded={stagedOpen()}
                    class="flex min-w-0 flex-1 items-center gap-1 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-v2-text-text-muted"
                    onClick={() => setStagedOpen((prev) => !prev)}
                  >
                    <Icon
                      name="outline-chevron-right"
                      size="small"
                      class="size-3 shrink-0 text-v2-icon-icon-muted transition-transform duration-150"
                      classList={{ "rotate-90": stagedOpen() }}
                    />
                    <span class="truncate">{tr("Staged", "Preparadas (Staged)")}</span>
                    <span class="ms-1 rounded-full bg-v2-background-bg-layer-02 px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none text-v2-text-text-muted">
                      {porcelain().staged.length}
                    </span>
                  </button>

                  <Show when={porcelain().staged.length > 0}>
                    <Tooltip placement="left" value={tr("Unstage all changes", "Despreparar todas as alterações")}>
                      <button
                        type="button"
                        disabled={isBusy()}
                        aria-label={tr("Unstage all changes", "Despreparar todas as alterações")}
                        class="flex size-5 shrink-0 items-center justify-center rounded-[4px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-40"
                        onClick={(e) => void handleUnstageAll(e)}
                      >
                        <Icon name="minus" size="small" class="size-3.5" />
                      </button>
                    </Tooltip>
                  </Show>
                </div>

                <Show when={stagedOpen()}>
                  <Show
                    when={porcelain().staged.length > 0}
                    fallback={
                      <div class="px-6 py-1.5 text-[11px] text-v2-text-text-faint">
                        {tr("No staged changes.", "Nenhuma alteração preparada.")}
                      </div>
                    }
                  >
                    <For each={porcelain().staged}>{(entry) => renderChangeRow(entry)}</For>
                  </Show>
                </Show>
              </div>

              {/* Working tree changes section */}
              <div class="mb-1 border-t border-v2-border-border-muted/60 pt-1">
                <div class="flex h-6.5 items-center justify-between gap-1 px-2 hover:bg-v2-overlay-simple-overlay-hover">
                  <button
                    type="button"
                    aria-expanded={changesOpen()}
                    class="flex min-w-0 flex-1 items-center gap-1 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-v2-text-text-muted"
                    onClick={() => setChangesOpen((prev) => !prev)}
                  >
                    <Icon
                      name="outline-chevron-right"
                      size="small"
                      class="size-3 shrink-0 text-v2-icon-icon-muted transition-transform duration-150"
                      classList={{ "rotate-90": changesOpen() }}
                    />
                    <span class="truncate">{tr("Changes", "Alterações")}</span>
                    <span class="ms-1 rounded-full bg-v2-background-bg-layer-02 px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none text-v2-text-text-muted">
                      {porcelain().unstaged.length}
                    </span>
                  </button>

                  <Show when={porcelain().unstaged.length > 0}>
                    <Tooltip placement="left" value={tr("Stage all changes", "Preparar todas as alterações")}>
                      <button
                        type="button"
                        disabled={isBusy()}
                        aria-label={tr("Stage all changes", "Preparar todas as alterações")}
                        class="flex size-5 shrink-0 items-center justify-center rounded-[4px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-40"
                        onClick={(e) => void handleStageAll(e)}
                      >
                        <Icon name="plus" size="small" class="size-3.5" />
                      </button>
                    </Tooltip>
                  </Show>
                </div>

                <Show when={changesOpen()}>
                  <Show
                    when={porcelain().unstaged.length > 0}
                    fallback={
                      <div class="px-6 py-1.5 text-[11px] text-v2-text-text-faint">
                        {totalChanges() === 0
                          ? tr("Working tree clean.", "Árvore de trabalho limpa.")
                          : tr("No unstaged changes.", "Nenhuma alteração pendente fora do stage.")}
                      </div>
                    }
                  >
                    <For each={porcelain().unstaged}>{(entry) => renderChangeRow(entry)}</For>
                  </Show>
                </Show>
              </div>

              {/* Worktrees collapsible section */}
              <div class="border-t border-v2-border-border-muted/60 pt-1">
                <div class="flex h-6.5 items-center justify-between gap-1 px-2 hover:bg-v2-overlay-simple-overlay-hover">
                  <button
                    type="button"
                    aria-expanded={worktreesOpen()}
                    class="flex min-w-0 flex-1 items-center gap-1 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-v2-text-text-muted"
                    onClick={() => setWorktreesOpen((prev) => !prev)}
                  >
                    <Icon
                      name="outline-chevron-right"
                      size="small"
                      class="size-3 shrink-0 text-v2-icon-icon-muted transition-transform duration-150"
                      classList={{ "rotate-90": worktreesOpen() }}
                    />
                    <Icon name="outline-worktree" size="small" class="size-3.5 shrink-0 text-v2-icon-icon-muted" />
                    <span class="truncate">Worktrees</span>
                    <span class="ms-1 rounded-full bg-v2-background-bg-layer-02 px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none text-v2-text-text-muted">
                      {worktrees().length}
                    </span>
                  </button>

                  <div class="flex shrink-0 items-center gap-0.5">
                    <Tooltip placement="left" value={tr("New worktree", "Novo worktree")}>
                      <button
                        type="button"
                        disabled={isBusy() || !projectInfo()}
                        aria-label={tr("Create new worktree", "Criar novo worktree")}
                        aria-pressed={creatingWorktree()}
                        class="flex size-5 items-center justify-center rounded-[4px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-40"
                        classList={{ "bg-v2-overlay-simple-overlay-pressed text-v2-text-text-base": creatingWorktree() }}
                        onClick={handleToggleCreateWorktree}
                      >
                        <Icon name="plus" size="small" class="size-3.5" />
                      </button>
                    </Tooltip>

                    <Tooltip placement="left" value={tr("Refresh worktrees", "Atualizar worktrees")}>
                      <button
                        type="button"
                        disabled={isBusy() || !projectInfo()}
                        aria-label={tr("Refresh worktrees list", "Atualizar lista de worktrees")}
                        class="flex size-5 items-center justify-center rounded-[4px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-40"
                        onClick={(e) => void handleRefreshWorktrees(e)}
                      >
                        <Show
                          when={busyAction() === "worktree"}
                          fallback={<Icon name="refresh" size="small" class="size-3" />}
                        >
                          <Loader width={11} height={11} />
                        </Show>
                      </button>
                    </Tooltip>
                  </div>
                </div>

                <Show when={worktreesOpen()}>
                  {/* Inline worktree creator */}
                  <Show when={creatingWorktree()}>
                    <form
                      class="mx-2 my-1.5 flex flex-col gap-1.5 rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-2"
                      onSubmit={(e) => void handleCreateWorktree(e)}
                    >
                      <div class="text-[11px] font-medium text-v2-text-text-muted">
                        {tr("Create Worktree", "Criar Worktree")}
                      </div>
                      <input
                        ref={worktreeBranchRef}
                        type="text"
                        value={worktreeBranch()}
                        disabled={isBusy()}
                        placeholder={tr("Base or new branch (optional)", "Branch base ou nova (opcional)")}
                        aria-label={tr("Worktree branch", "Branch do worktree")}
                        class="h-7 w-full rounded-[5px] border border-v2-border-border-base bg-v2-background-bg-deep px-2 text-[11.5px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint focus:border-v2-border-border-focus"
                        onInput={(e) => {
                          setWorktreeBranch(e.currentTarget.value)
                          setWorktreeError(undefined)
                        }}
                      />
                      <input
                        type="text"
                        value={worktreeName()}
                        disabled={isBusy()}
                        placeholder={tr("Worktree name (optional)", "Nome do worktree (opcional)")}
                        aria-label={tr("Worktree name", "Nome do worktree")}
                        class="h-7 w-full rounded-[5px] border border-v2-border-border-base bg-v2-background-bg-deep px-2 text-[11.5px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint focus:border-v2-border-border-focus"
                        onInput={(e) => {
                          setWorktreeName(e.currentTarget.value)
                          setWorktreeError(undefined)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            e.stopPropagation()
                            setCreatingWorktree(false)
                          }
                        }}
                      />
                      <Show when={worktreeErrorMessage()}>
                        {(message) => <div class="text-[11px] text-v2-state-fg-danger">{message()}</div>}
                      </Show>
                      <div class="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          disabled={isBusy()}
                          class="h-6.5 rounded-[5px] border border-v2-border-border-base px-2 text-[11px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                          onClick={() => setCreatingWorktree(false)}
                        >
                          {tr("Cancel", "Cancelar")}
                        </button>
                        <button
                          type="submit"
                          disabled={isBusy()}
                          class="flex h-6.5 items-center gap-1 rounded-[5px] bg-v2-background-bg-accent px-2.5 text-[11px] font-medium text-v2-text-text-inverse hover:opacity-90 disabled:opacity-50"
                        >
                          <Show when={busyAction() === "worktree"}>
                            <Loader width={11} height={11} />
                          </Show>
                          <span>{tr("Create", "Criar")}</span>
                        </button>
                      </div>
                    </form>
                  </Show>

                  <Show
                    when={worktrees().length > 0}
                    fallback={
                      <div class="px-6 py-1.5 text-[11px] text-v2-text-text-faint">
                        {tr("No worktrees found.", "Nenhum worktree encontrado.")}
                      </div>
                    }
                  >
                    <For each={worktrees()}>
                      {(wt) => {
                        const label = getFilename(wt.directory) || wt.directory
                        const isActive = () => sameDirectory(wt.directory, workbench.activeDirectory())
                        const isCanonical = () => sameDirectory(wt.directory, projectInfo()?.canonical)
                        const isRemoveArmed = () => confirmRemoveWorktree() === wt.directory

                        return (
                          <div
                            class="group/wt flex min-h-[32px] items-center gap-1.5 px-2.5 py-1 transition-colors hover:bg-v2-overlay-simple-overlay-hover"
                            title={wt.directory}
                          >
                            <Icon name="folder" size="small" class="size-3.5 shrink-0 text-v2-icon-icon-muted" />
                            <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
                              <div class="flex items-center gap-1.5">
                                <span class="truncate text-[12px] font-medium text-v2-text-text-base">{label}</span>
                                <Show when={isActive()}>
                                  <span class="shrink-0 rounded bg-v2-background-bg-accent/15 px-1 py-0.5 text-[9.5px] font-medium leading-none text-v2-text-text-accent">
                                    {tr("Current", "Atual")}
                                  </span>
                                </Show>
                                <Show when={isCanonical() && !isActive()}>
                                  <span class="shrink-0 rounded bg-v2-background-bg-layer-02 px-1 py-0.5 text-[9.5px] leading-none text-v2-text-text-faint">
                                    {tr("Main", "Principal")}
                                  </span>
                                </Show>
                              </div>
                              <span class="truncate text-[10.5px] text-v2-text-text-faint">{wt.directory}</span>
                            </div>

                            <div
                              class="flex shrink-0 items-center gap-0.5 transition-opacity duration-100"
                              classList={{
                                "opacity-100": isRemoveArmed(),
                                "opacity-0 group-hover/wt:opacity-100 group-focus-within/wt:opacity-100": !isRemoveArmed(),
                              }}
                            >
                              <Tooltip
                                placement="top"
                                value={tr("Open draft session in this worktree", "Abrir sessão rascunho neste worktree")}
                              >
                                <button
                                  type="button"
                                  class="flex size-5 items-center justify-center rounded-[4px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                                  aria-label={tr("Open session in {{label}}", "Abrir sessão em {{label}}", { label })}
                                  onClick={(e) => void handleOpenWorktreeDraft(e, wt.directory)}
                                >
                                  <Icon name="new-session" size="small" class="size-3.5" />
                                </button>
                              </Tooltip>

                              <Show when={!isCanonical()}>
                                <Tooltip
                                  placement="top"
                                  value={
                                    isRemoveArmed()
                                      ? tr(
                                          "Click again to confirm worktree removal",
                                          "Clique novamente para confirmar remoção do worktree",
                                        )
                                      : tr("Remove worktree", "Remover worktree")
                                  }
                                >
                                  <button
                                    type="button"
                                    disabled={isBusy()}
                                    class="flex size-5 items-center justify-center rounded-[4px] transition-colors disabled:opacity-40"
                                    classList={{
                                      "bg-v2-state-bg-danger text-v2-state-fg-danger": isRemoveArmed(),
                                      "text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-state-fg-danger":
                                        !isRemoveArmed(),
                                    }}
                                    aria-label={
                                      isRemoveArmed()
                                        ? tr("Confirm removing worktree {{label}}", "Confirmar remoção do worktree {{label}}", {
                                            label,
                                          })
                                        : tr("Remove worktree {{label}}", "Remover worktree {{label}}", { label })
                                    }
                                    onClick={(e) => void handleRemoveWorktree(e, wt.directory)}
                                  >
                                    <Show
                                      when={isRemoveArmed()}
                                      fallback={<Icon name="outline-trash" size="small" class="size-3.5" />}
                                    >
                                      <Icon name="outline-hexagonal-warning" size="small" class="size-3.5" />
                                    </Show>
                                  </button>
                                </Tooltip>
                              </Show>
                            </div>
                          </div>
                        )
                      }}
                    </For>
                  </Show>
                </Show>
              </div>
            </div>
          </div>
        </Show>
      </Show>
    </Show>
  )
}

function normalizeRelativePath(value: string) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+|\/+$/g, "")
}

function parentDirectory(relPath: string) {
  return getDirectory(normalizeRelativePath(relPath)).replace(/\/+$/, "")
}

function sameDirectory(a: string | undefined, b: string | undefined) {
  if (!a || !b) return false
  const normA = a.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()
  const normB = b.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()
  return normA === normB
}

function splitPorcelainRename(raw: string): { path: string; originalPath?: string } {
  let inQuotes = false
  let escaped = false

  for (let index = 0; index < raw.length; index++) {
    const ch = raw[index]

    if (escaped) {
      escaped = false
      continue
    }

    if (inQuotes && ch === "\\") {
      escaped = true
      continue
    }

    if (ch === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (!inQuotes && raw.slice(index, index + 4) === " -> ") {
      return {
        originalPath: unquoteGitPath(raw.slice(0, index)),
        path: unquoteGitPath(raw.slice(index + 4)),
      }
    }
  }

  return { path: unquoteGitPath(raw) }
}

function unquoteGitPath(raw: string) {
  const trimmed = raw.trim()
  if (trimmed.length < 2 || !trimmed.startsWith('"') || !trimmed.endsWith('"')) {
    return normalizeRelativePath(trimmed)
  }

  const inner = trimmed.slice(1, -1)
  const bytes: number[] = []
  const encoder = new TextEncoder()

  let index = 0
  while (index < inner.length) {
    const ch = inner[index]
    if (ch !== "\\") {
      for (const byte of encoder.encode(ch)) bytes.push(byte)
      index += 1
      continue
    }

    const next = inner[index + 1]
    if (!next) {
      bytes.push(92)
      index += 1
      continue
    }

    if (/^[0-7]{3}$/.test(inner.slice(index + 1, index + 4))) {
      bytes.push(Number.parseInt(inner.slice(index + 1, index + 4), 8))
      index += 4
      continue
    }

    for (const byte of encoder.encode(decodeGitEscape(next))) bytes.push(byte)
    index += 2
  }

  return normalizeRelativePath(new TextDecoder("utf-8").decode(new Uint8Array(bytes)))
}

function decodeGitEscape(ch: string) {
  if (ch === "n") return "\n"
  if (ch === "r") return "\r"
  if (ch === "t") return "\t"
  if (ch === "b") return "\b"
  if (ch === "f") return "\f"
  if (ch === "v") return "\v"
  return ch
}

function changeToneClass(code: string) {
  if (code === "M" || code === "R" || code === "C" || code === "T") return "text-v2-state-fg-warning"
  if (code === "A") return "text-v2-state-fg-success"
  if (code === "D" || code === "!") return "text-v2-state-fg-danger"
  return "text-v2-state-fg-info"
}

function isWindowsPath(directory: string) {
  return /^[A-Za-z]:[/\\]/.test(directory) || directory.includes("\\")
}

function dialectFromShellPath(shellPath: string): ShellDialect {
  const base = shellPath
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)
    ?.toLowerCase()
    .replace(/\.exe$/, "")

  if (base === "pwsh" || base === "powershell") return "powershell"
  if (base === "cmd") return "cmd"
  return "posix"
}

function quoteShellArg(value: string, dialect: ShellDialect) {
  const clean = value.replaceAll("\0", "")

  if (dialect === "powershell") {
    return `'${clean.replaceAll("'", "''")}'`
  }

  if (dialect === "cmd") {
    const singleLine = clean.replaceAll("\r", " ").replaceAll("\n", " ")
    return `"${singleLine.replaceAll('"', '\\"').replaceAll("%", "%%")}"`
  }

  return `'${clean.replaceAll("'", "'\\''")}'`
}

function doubleDashArg(dialect: ShellDialect) {
  return dialect === "cmd" ? "--" : "'--'"
}

function buildSafeCommitCommand(message: string, dialect: ShellDialect) {
  const normalized = message.replaceAll("\r\n", "\n").trim()

  if (dialect === "cmd") {
    const paragraphs = normalized
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0)

    return `git commit ${paragraphs.map((part) => `-m ${quoteShellArg(part, dialect)}`).join(" ")}`
  }

  return `git commit -m ${quoteShellArg(normalized, dialect)}`
}

function isValidBranchName(name: string) {
  if (!name || name.startsWith("-") || name.startsWith("/") || name.endsWith("/") || name.endsWith(".")) return false
  if (name.endsWith(".lock") || name.includes("..") || name.includes("@{") || name.includes("//")) return false
  if (/[\s~^:?*[\]\\]/.test(name)) return false
  return !/[\u0000-\u001f\u007f]/.test(name)
}

function isShellSuccess(result: ShellRunResult) {
  return !result.error && result.exit === 0
}

function isUnbornHeadError(output: string) {
  return /ambiguous argument 'HEAD'|unknown revision|bad revision 'HEAD'|unborn/i.test(output)
}

function firstNonEmptyLine(text: string) {
  return (
    text
      .replaceAll("\r\n", "\n")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ""
  )
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

function GitPullIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M8 2.5v8.25M4.75 7.75 8 11l3.25-3.25M3 13.5h10"
        stroke="currentColor"
        stroke-width="1.35"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

function GitPushIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M8 11.25V3M4.75 6 8 2.75 11.25 6M3 13.5h10"
        stroke="currentColor"
        stroke-width="1.35"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}
