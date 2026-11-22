import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Command } from "@opencode/core/command"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { Bus } from "@opencode/core/bus"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { Mcp } from "@opencode/core/mcp/index"
import { CommandPlugin, planAndPersistMission, selectArenaModels } from "@opencode/core/plugin/command"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/schema/session"
import { SessionInbox } from "@opencode/schema/session-inbox"
import { SessionMessage } from "@opencode/schema/session-message"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { DateTime } from "effect"
import { emptyMcpLayer } from "../fixture/mcp"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { host } from "./host"
import PROMPT_INITIALIZE from "../../src/plugin/command/initialize.txt"
import PROMPT_REVIEW from "../../src/plugin/command/review.txt"

const directory = AbsolutePath.make("/repo/packages/app")
const project = AbsolutePath.make("/repo")
const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory }, { projectDirectory: project })),
)
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Command.node, Mcp.node, Bus.node]), [
    Mcp.node.replace(emptyMcpLayer),
    Location.node.replace(locationLayer),
  ]),
)

describe("CommandPlugin.Plugin", () => {
  it.effect("does not invent Arena model references when the catalog is empty", () =>
    Effect.gen(function* () {
      const ineligible = {
        ...Model.Info.default(Provider.ID.make("provider"), Model.ID.make("disabled")),
        enabled: false,
      }
      const error = yield* Effect.flip(selectArenaModels([ineligible]))
      expect(error.message).toBe("Arena requires at least one enabled, non-deprecated model")
    }),
  )

  it.effect("selects up to three enabled non-deprecated Arena models", () =>
    Effect.gen(function* () {
      const info = (id: string, enabled = true, status: "active" | "deprecated" = "active") => ({
        ...Model.Info.default(Provider.ID.make("provider"), Model.ID.make(id)),
        enabled,
        status,
      })
      expect(
        yield* selectArenaModels([
          info("disabled", false),
          info("deprecated", true, "deprecated"),
          info("one"),
          info("two"),
          info("three"),
          info("four"),
        ]),
      ).toEqual(["provider/one", "provider/two", "provider/three"])
    }),
  )

  it.effect("uses the planner mission ID when persisting Omni, Ultrawork, Arena, and Team missions", () =>
    Effect.gen(function* () {
      const subtasks = [{ id: "task-1", title: "Task", assignedAgent: "coder" }]
      for (const mode of ["omni", "ultrawork", "arena", "team"]) {
        const missionID = `mission-${mode}`
        const calls: string[] = []
        const mission = yield* planAndPersistMission({
          missionID,
          goal: "goal",
          mode,
          fallbackSessionID: "local",
          plan: (id) =>
            Effect.sync(() => {
              calls.push(`plan:${id}`)
              return subtasks
            }),
          save: (input) =>
            Effect.sync(() => {
              calls.push(`save:${input.id}:${input.mode}`)
              return input.id ?? "missing-id"
            }),
        })
        expect(calls).toEqual([`plan:${missionID}`, `save:${missionID}:${mode}`])
        expect(mission).toEqual({ subtasks, sessionID: missionID })
      }
    }),
  )

  it.effect("registers built-in init and review commands", () =>
    Effect.gen(function* () {
      const command = yield* Command.Service
      const prompts: {
        text: string
        files?: readonly { readonly uri: string }[]
        delivery?: "steer" | "queue"
      }[] = []
      yield* CommandPlugin.Plugin.effect(
        host({
          command: {
            list: () => Effect.die("unused command.list"),
            transform: command.transform,
            reload: command.reload,
          },
          session: {
            prompt: (input) =>
              Effect.sync(() => {
                prompts.push({ text: input.text, files: input.files, delivery: input.delivery })
                return SessionInbox.User.make({
                  id: SessionMessage.ID.make("msg_test"),
                  sessionID: input.sessionID,
                  time: { created: DateTime.makeUnsafe(0) },
                  type: "user",
                  payload: { text: input.text },
                  delivery: input.delivery ?? "steer",
                })
              }),
          },
        }),
      ).pipe(
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory }, { projectDirectory: project })),
        ),
      )

      expect(yield* command.get("init")).toMatchObject({
        name: "init",
        description: "Guided AGENTS.md setup for the project",
      })
      expect(yield* command.get("review")).toMatchObject({
        name: "review",
        description: "Review changes [commit|branch|pr], defaults to uncommitted",
      })
      yield* command.execute({
        name: "init",
        invocation: {
          sessionID: Session.ID.make("ses_test"),
          prompt: { text: "extra context", files: [{ uri: "file:///tmp/context.md" }] },
          delivery: "queue",
        },
      })
      yield* command.execute({
        name: "review",
        invocation: {
          sessionID: Session.ID.make("ses_test"),
          prompt: { text: "  branch $& $$ $` $'  " },
          delivery: "steer",
        },
      })
      yield* command.execute({
        name: "init",
        invocation: {
          sessionID: Session.ID.make("ses_test"),
          prompt: { text: "" },
          delivery: "steer",
        },
      })
      yield* command.execute({
        name: "review",
        invocation: {
          sessionID: Session.ID.make("ses_test"),
          prompt: { text: "   " },
          delivery: "steer",
        },
      })
      expect(prompts).toEqual([
        {
          text: PROMPT_INITIALIZE.replace("${path}", project).replaceAll("$ARGUMENTS", "extra context"),
          files: [{ uri: "file:///tmp/context.md" }],
          delivery: "queue",
        },
        {
          text: PROMPT_REVIEW.replace("${path}", project).replaceAll("$ARGUMENTS", () => "branch $& $$ $` $'"),
          files: undefined,
          delivery: "steer",
        },
        {
          text: PROMPT_INITIALIZE.replace("${path}", project).replaceAll("$ARGUMENTS", ""),
          files: undefined,
          delivery: "steer",
        },
        {
          text: PROMPT_REVIEW.replace("${path}", project).replaceAll("$ARGUMENTS", ""),
          files: undefined,
          delivery: "steer",
        },
      ])
    }),
  )

  it.effect("registers built-in grillme interview command", () =>
    Effect.gen(function* () {
      const command = yield* Command.Service
      const prompts: Array<{ text: string; delivery: string }> = []
      yield* CommandPlugin.Plugin.effect(
        host({
          command: {
            list: () => Effect.die("unused command.list"),
            transform: command.transform,
            reload: command.reload,
          },
          storage: {
            get: () => Effect.succeed(undefined),
            set: () => Effect.void,
            remove: () => Effect.void,
            scan: () => Effect.succeed({ entries: [] }),
          },
          session: {
            prompt: (input) =>
              Effect.sync(() => {
                prompts.push({ text: input.text, delivery: input.delivery ?? "steer" })
                return SessionInbox.User.make({
                  id: SessionMessage.ID.make("msg_test"),
                  sessionID: input.sessionID,
                  time: { created: DateTime.makeUnsafe(0) },
                  type: "user",
                  payload: { text: input.text },
                  delivery: input.delivery ?? "steer",
                })
              }),
          },
        }),
      ).pipe(
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory }, { projectDirectory: project })),
        ),
      )

      expect(yield* command.get("grillme")).toMatchObject({
        name: "grillme",
        description: "Interview me about a feature, then produce a specification for explicit review",
      })

      yield* command.execute({
        name: "grillme",
        invocation: {
          sessionID: Session.ID.make("ses_test"),
          prompt: { text: "add a checkout feature" },
          delivery: "steer",
        },
      })

      expect(prompts).toHaveLength(1)
      expect(prompts[0].delivery).toBe("steer")
      expect(prompts[0].text).toContain("[GRILLME — ITERATIVE TECHNICAL INTERVIEW]")
      expect(prompts[0].text).toContain("Do not implement during the interview")
      expect(prompts[0].text).toContain("This prompt is guidance, not a tool-level authorization barrier")
      expect(prompts[0].text).toContain("Latest user input: add a checkout feature")
    }),
  )

  it.effect("grillme passes empty prompt text when invoked without arguments", () =>
    Effect.gen(function* () {
      const command = yield* Command.Service
      const prompts: Array<{ text: string; delivery: string }> = []
      yield* CommandPlugin.Plugin.effect(
        host({
          command: {
            list: () => Effect.die("unused command.list"),
            transform: command.transform,
            reload: command.reload,
          },
          storage: {
            get: () => Effect.succeed(undefined),
            set: () => Effect.void,
            remove: () => Effect.void,
            scan: () => Effect.succeed({ entries: [] }),
          },
          session: {
            prompt: (input) =>
              Effect.sync(() => {
                prompts.push({ text: input.text, delivery: input.delivery ?? "steer" })
                return SessionInbox.User.make({
                  id: SessionMessage.ID.make("msg_test"),
                  sessionID: input.sessionID,
                  time: { created: DateTime.makeUnsafe(0) },
                  type: "user",
                  payload: { text: input.text },
                  delivery: input.delivery ?? "steer",
                })
              }),
          },
        }),
      ).pipe(
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory }, { projectDirectory: project })),
        ),
      )

      yield* command.execute({
        name: "grillme",
        invocation: {
          sessionID: Session.ID.make("ses_test"),
          prompt: { text: "" },
          delivery: "queue",
        },
      })

      expect(prompts).toHaveLength(1)
      expect(prompts[0].delivery).toBe("queue")
      expect(prompts[0].text).toContain("[GRILLME — ITERATIVE TECHNICAL INTERVIEW]")
      expect(prompts[0].text).toContain("Latest user input: (resume)")
    }),
  )

  // ===== Focused grillme state machine tests with stateful in-memory storage =====

  it.effect("grillme: approve before spec_ready keeps interviewing", () =>
    Effect.gen(function* () {
      const command = yield* Command.Service
      const prompts: Array<{ text: string; delivery: string }> = []
      const storage = new Map<string, unknown>()
      yield* CommandPlugin.Plugin.effect(
        host({
          command: {
            list: () => Effect.die("unused command.list"),
            transform: command.transform,
            reload: command.reload,
          },
          storage: {
            get: (key: string) => Effect.sync(() => storage.get(key) as Schema.Json | undefined),
            set: (key, value) => Effect.sync(() => void storage.set(key, value)),
            remove: () => Effect.void,
            scan: () => Effect.succeed({ entries: [] }),
          },
          session: {
            prompt: (input) =>
              Effect.sync(() => {
                prompts.push({ text: input.text, delivery: input.delivery ?? "steer" })
                return SessionInbox.User.make({
                  id: SessionMessage.ID.make("msg_test"),
                  sessionID: input.sessionID,
                  time: { created: DateTime.makeUnsafe(0) },
                  type: "user",
                  payload: { text: input.text },
                  delivery: input.delivery ?? "steer",
                })
              }),
          },
        }),
      ).pipe(
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory }, { projectDirectory: project })),
        ),
      )

      const sessionID = Session.ID.make("ses_approve_before_ready")
      yield* command.execute({
        name: "grillme",
        invocation: { sessionID, prompt: { text: "add feature" }, delivery: "steer" },
      })
      expect(prompts[0].text).toContain("[GRILLME — ITERATIVE TECHNICAL INTERVIEW]")
      prompts.length = 0

      // Say "approve" before "spec ready" — should stay in interviewing
      yield* command.execute({
        name: "grillme",
        invocation: { sessionID, prompt: { text: "approve" }, delivery: "steer" },
      })
      expect(prompts[0].text).toContain("Status: interviewing")
    }),
  )

  it.effect("grillme: interview -> spec_ready -> approve transitions to approved", () =>
    Effect.gen(function* () {
      const command = yield* Command.Service
      const prompts: Array<{ text: string; delivery: string }> = []
      const storage = new Map<string, unknown>()
      yield* CommandPlugin.Plugin.effect(
        host({
          command: {
            list: () => Effect.die("unused command.list"),
            transform: command.transform,
            reload: command.reload,
          },
          storage: {
            get: (key: string) => Effect.sync(() => storage.get(key) as Schema.Json | undefined),
            set: (key, value) => Effect.sync(() => void storage.set(key, value)),
            remove: () => Effect.void,
            scan: () => Effect.succeed({ entries: [] }),
          },
          session: {
            prompt: (input) =>
              Effect.sync(() => {
                prompts.push({ text: input.text, delivery: input.delivery ?? "steer" })
                return SessionInbox.User.make({
                  id: SessionMessage.ID.make("msg_test"),
                  sessionID: input.sessionID,
                  time: { created: DateTime.makeUnsafe(0) },
                  type: "user",
                  payload: { text: input.text },
                  delivery: input.delivery ?? "steer",
                })
              }),
          },
        }),
      ).pipe(
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory }, { projectDirectory: project })),
        ),
      )

      const sessionID = Session.ID.make("ses_interview_approve")
      // Initial prompt
      yield* command.execute({
        name: "grillme",
        invocation: { sessionID, prompt: { text: "add auth" }, delivery: "steer" },
      })
      expect(prompts[0].text).toContain("[GRILLME — ITERATIVE TECHNICAL INTERVIEW]")
      prompts.length = 0

      // Answer a question (stays interviewing)
      yield* command.execute({
        name: "grillme",
        invocation: { sessionID, prompt: { text: "using JWT tokens" }, delivery: "steer" },
      })
      expect(prompts[0].text).toContain("Status: interviewing")
      prompts.length = 0

      // Say "spec ready" — moves to spec_ready
      yield* command.execute({
        name: "grillme",
        invocation: { sessionID, prompt: { text: "spec ready" }, delivery: "steer" },
      })
      expect(prompts[0].text).toContain("Status: spec_ready")
      prompts.length = 0

      // Say "approve" — moves to approved
      yield* command.execute({
        name: "grillme",
        invocation: { sessionID, prompt: { text: "approve" }, delivery: "steer" },
      })
      expect(prompts[0].text).toContain("Status: approved")
    }),
  )

  it.effect("grillme: substantive answer after spec_ready invalidates specReady gate", () =>
    Effect.gen(function* () {
      const command = yield* Command.Service
      const prompts: Array<{ text: string; delivery: string }> = []
      const storage = new Map<string, unknown>()
      yield* CommandPlugin.Plugin.effect(
        host({
          command: {
            list: () => Effect.die("unused command.list"),
            transform: command.transform,
            reload: command.reload,
          },
          storage: {
            get: (key: string) => Effect.sync(() => storage.get(key) as Schema.Json | undefined),
            set: (key, value) => Effect.sync(() => void storage.set(key, value)),
            remove: () => Effect.void,
            scan: () => Effect.succeed({ entries: [] }),
          },
          session: {
            prompt: (input) =>
              Effect.sync(() => {
                prompts.push({ text: input.text, delivery: input.delivery ?? "steer" })
                return SessionInbox.User.make({
                  id: SessionMessage.ID.make("msg_test"),
                  sessionID: input.sessionID,
                  time: { created: DateTime.makeUnsafe(0) },
                  type: "user",
                  payload: { text: input.text },
                  delivery: input.delivery ?? "steer",
                })
              }),
          },
        }),
      ).pipe(
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory }, { projectDirectory: project })),
        ),
      )

      const sessionID = Session.ID.make("ses_spec_ready_invalidated")
      // Initial prompt
      yield* command.execute({
        name: "grillme",
        invocation: { sessionID, prompt: { text: "add auth" }, delivery: "steer" },
      })
      prompts.length = 0

      // Say "spec ready" — moves to spec_ready
      yield* command.execute({
        name: "grillme",
        invocation: { sessionID, prompt: { text: "spec ready" }, delivery: "steer" },
      })
      expect(prompts[0].text).toContain("Status: spec_ready")
      prompts.length = 0

      // Substantive follow-up answer — should clear specReady and return to interviewing
      yield* command.execute({
        name: "grillme",
        invocation: { sessionID, prompt: { text: "also need refresh tokens" }, delivery: "steer" },
      })
      expect(prompts[0].text).toContain("Status: interviewing")
      prompts.length = 0

      // Now "approve" without re-saying "spec ready" — should stay interviewing
      yield* command.execute({
        name: "grillme",
        invocation: { sessionID, prompt: { text: "approve" }, delivery: "steer" },
      })
      expect(prompts[0].text).toContain("Status: interviewing")
    }),
  )

  it.effect("grillme: terminal approved state is completely frozen (no appends, no timestamp change)", () =>
    Effect.gen(function* () {
      const command = yield* Command.Service
      const prompts: Array<{ text: string; delivery: string }> = []
      const storage = new Map<string, unknown>()
      yield* CommandPlugin.Plugin.effect(
        host({
          command: {
            list: () => Effect.die("unused command.list"),
            transform: command.transform,
            reload: command.reload,
          },
          storage: {
            get: (key: string) => Effect.sync(() => storage.get(key) as Schema.Json | undefined),
            set: (key, value) => Effect.sync(() => void storage.set(key, value)),
            remove: () => Effect.void,
            scan: () => Effect.succeed({ entries: [] }),
          },
          session: {
            prompt: (input) =>
              Effect.sync(() => {
                prompts.push({ text: input.text, delivery: input.delivery ?? "steer" })
                return SessionInbox.User.make({
                  id: SessionMessage.ID.make("msg_test"),
                  sessionID: input.sessionID,
                  time: { created: DateTime.makeUnsafe(0) },
                  type: "user",
                  payload: { text: input.text },
                  delivery: input.delivery ?? "steer",
                })
              }),
          },
        }),
      ).pipe(
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory }, { projectDirectory: project })),
        ),
      )

      const sessionID = Session.ID.make("ses_terminal_frozen")
      // Reach approved state
      yield* command.execute({ name: "grillme", invocation: { sessionID, prompt: { text: "add auth" }, delivery: "steer" } })
      prompts.length = 0
      yield* command.execute({ name: "grillme", invocation: { sessionID, prompt: { text: "spec ready" }, delivery: "steer" } })
      prompts.length = 0
      yield* command.execute({ name: "grillme", invocation: { sessionID, prompt: { text: "approve" }, delivery: "steer" } })
      expect(prompts[0].text).toContain("Status: approved")
      prompts.length = 0

      // Capture stored state after approval
      const key = `grillme:v1:${sessionID}`
      const stateAfterApprove = storage.get(key) as { status: string; answers: string[]; updatedAt: string }
      expect(stateAfterApprove.status).toBe("approved")
      const answersAtApproval = [...stateAfterApprove.answers]
      const updatedAtAtApproval = stateAfterApprove.updatedAt

      // Send arbitrary follow-up input — state must NOT change
      yield* command.execute({ name: "grillme", invocation: { sessionID, prompt: { text: "random follow-up" }, delivery: "steer" } })
      expect(prompts[0].text).toContain("Status: approved")
      prompts.length = 0

      const stateAfterFollowup = storage.get(key) as { status: string; answers: string[]; updatedAt: string }
      expect(stateAfterFollowup.status).toBe("approved")
      expect(stateAfterFollowup.answers).toEqual(answersAtApproval)
      expect(stateAfterFollowup.updatedAt).toBe(updatedAtAtApproval)
    }),
  )

  it.effect("grillme: terminal cancelled state is completely frozen", () =>
    Effect.gen(function* () {
      const command = yield* Command.Service
      const prompts: Array<{ text: string; delivery: string }> = []
      const storage = new Map<string, unknown>()
      yield* CommandPlugin.Plugin.effect(
        host({
          command: {
            list: () => Effect.die("unused command.list"),
            transform: command.transform,
            reload: command.reload,
          },
          storage: {
            get: (key: string) => Effect.sync(() => storage.get(key) as Schema.Json | undefined),
            set: (key, value) => Effect.sync(() => void storage.set(key, value)),
            remove: () => Effect.void,
            scan: () => Effect.succeed({ entries: [] }),
          },
          session: {
            prompt: (input) =>
              Effect.sync(() => {
                prompts.push({ text: input.text, delivery: input.delivery ?? "steer" })
                return SessionInbox.User.make({
                  id: SessionMessage.ID.make("msg_test"),
                  sessionID: input.sessionID,
                  time: { created: DateTime.makeUnsafe(0) },
                  type: "user",
                  payload: { text: input.text },
                  delivery: input.delivery ?? "steer",
                })
              }),
          },
        }),
      ).pipe(
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory }, { projectDirectory: project })),
        ),
      )

      const sessionID = Session.ID.make("ses_terminal_cancelled")
      yield* command.execute({ name: "grillme", invocation: { sessionID, prompt: { text: "add auth" }, delivery: "steer" } })
      prompts.length = 0
      yield* command.execute({ name: "grillme", invocation: { sessionID, prompt: { text: "cancel" }, delivery: "steer" } })
      expect(prompts[0].text).toContain("Status: cancelled")
      prompts.length = 0

      const key = `grillme:v1:${sessionID}`
      const stateAfterCancel = storage.get(key) as { status: string; answers: string[]; updatedAt: string }
      expect(stateAfterCancel.status).toBe("cancelled")
      const answersAtCancel = [...stateAfterCancel.answers]
      const updatedAtAtCancel = stateAfterCancel.updatedAt

      // Send arbitrary follow-up input — state must NOT change
      yield* command.execute({ name: "grillme", invocation: { sessionID, prompt: { text: "random follow-up" }, delivery: "steer" } })
      expect(prompts[0].text).toContain("Status: cancelled")
      prompts.length = 0

      const stateAfterFollowup = storage.get(key) as { status: string; answers: string[]; updatedAt: string }
      expect(stateAfterFollowup.status).toBe("cancelled")
      expect(stateAfterFollowup.answers).toEqual(answersAtCancel)
      expect(stateAfterFollowup.updatedAt).toBe(updatedAtAtCancel)
    }),
  )

  it.effect("grillme: per-session key isolation (different sessions do not share state)", () =>
    Effect.gen(function* () {
      const command = yield* Command.Service
      const prompts: Array<{ text: string; delivery: string }> = []
      const storage = new Map<string, unknown>()
      yield* CommandPlugin.Plugin.effect(
        host({
          command: {
            list: () => Effect.die("unused command.list"),
            transform: command.transform,
            reload: command.reload,
          },
          storage: {
            get: (key: string) => Effect.sync(() => storage.get(key) as Schema.Json | undefined),
            set: (key, value) => Effect.sync(() => void storage.set(key, value)),
            remove: () => Effect.void,
            scan: () => Effect.succeed({ entries: [] }),
          },
          session: {
            prompt: (input) =>
              Effect.sync(() => {
                prompts.push({ text: input.text, delivery: input.delivery ?? "steer" })
                return SessionInbox.User.make({
                  id: SessionMessage.ID.make("msg_test"),
                  sessionID: input.sessionID,
                  time: { created: DateTime.makeUnsafe(0) },
                  type: "user",
                  payload: { text: input.text },
                  delivery: input.delivery ?? "steer",
                })
              }),
          },
        }),
      ).pipe(
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory }, { projectDirectory: project })),
        ),
      )

      const sessionA = Session.ID.make("ses_isolation_a")
      const sessionB = Session.ID.make("ses_isolation_b")

      // Session A starts
      yield* command.execute({ name: "grillme", invocation: { sessionID: sessionA, prompt: { text: "feature A" }, delivery: "steer" } })
      prompts.length = 0
      yield* command.execute({ name: "grillme", invocation: { sessionID: sessionA, prompt: { text: "spec ready" }, delivery: "steer" } })
      prompts.length = 0
      yield* command.execute({ name: "grillme", invocation: { sessionID: sessionA, prompt: { text: "approve" }, delivery: "steer" } })
      expect(prompts[0].text).toContain("Status: approved")
      prompts.length = 0

      // Session B starts — should be fresh interviewing state
      yield* command.execute({ name: "grillme", invocation: { sessionID: sessionB, prompt: { text: "feature B" }, delivery: "steer" } })
      expect(prompts[0].text).toContain("[GRILLME — ITERATIVE TECHNICAL INTERVIEW]")
      expect(prompts[0].text).toContain("Status: interviewing")
      prompts.length = 0

      // Session A remains approved
      yield* command.execute({ name: "grillme", invocation: { sessionID: sessionA, prompt: { text: "random" }, delivery: "steer" } })
      expect(prompts[0].text).toContain("Status: approved")

      // Verify storage keys are separate
      expect(storage.has(`grillme:v1:${sessionA}`)).toBe(true)
      expect(storage.has(`grillme:v1:${sessionB}`)).toBe(true)
    }),
  )

  it.effect("grillme: supports /grill-me and /grilme aliases, Portuguese control phrases, and reset from terminal state", () =>
    Effect.gen(function* () {
      const command = yield* Command.Service
      const prompts: Array<{ text: string; delivery: string }> = []
      const storage = new Map<string, unknown>()
      yield* CommandPlugin.Plugin.effect(
        host({
          command: {
            list: () => Effect.die("unused command.list"),
            transform: command.transform,
            reload: command.reload,
          },
          storage: {
            get: (key: string) => Effect.sync(() => storage.get(key) as Schema.Json | undefined),
            set: (key, value) => Effect.sync(() => void storage.set(key, value)),
            remove: () => Effect.void,
            scan: () => Effect.succeed({ entries: [] }),
          },
          session: {
            prompt: (input) =>
              Effect.sync(() => {
                prompts.push({ text: input.text, delivery: input.delivery ?? "steer" })
                return SessionInbox.User.make({
                  id: SessionMessage.ID.make("msg_test"),
                  sessionID: input.sessionID,
                  time: { created: DateTime.makeUnsafe(0) },
                  type: "user",
                  payload: { text: input.text },
                  delivery: input.delivery ?? "steer",
                })
              }),
          },
        }),
      ).pipe(
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory }, { projectDirectory: project })),
        ),
      )

      const sessionID = Session.ID.make("ses_aliases_pt_reset")

      // Start via /grill-me
      yield* command.execute({
        name: "grill-me",
        invocation: { sessionID, prompt: { text: "criar autenticacao oauth" }, delivery: "steer" },
      })
      expect(prompts[0].text).toContain("Status: interviewing")
      expect(prompts[0].text).toContain("criar autenticacao oauth")
      prompts.length = 0

      // Cancel in Portuguese via /grilme
      yield* command.execute({
        name: "grilme",
        invocation: { sessionID, prompt: { text: "cancelar" }, delivery: "steer" },
      })
      expect(prompts[0].text).toContain("Status: cancelled")
      prompts.length = 0

      // Reset and start a new topic in the same session
      yield* command.execute({
        name: "grill-me",
        invocation: { sessionID, prompt: { text: "reset novo fluxo de pagamento" }, delivery: "steer" },
      })
      expect(prompts[0].text).toContain("Status: interviewing")
      expect(prompts[0].text).toContain('Persisted answers/context: ["novo fluxo de pagamento"]')
      prompts.length = 0

      // Mark spec ready and approve in Portuguese
      yield* command.execute({
        name: "grill-me",
        invocation: { sessionID, prompt: { text: "especificação pronta" }, delivery: "steer" },
      })
      expect(prompts[0].text).toContain("Status: spec_ready")
      prompts.length = 0

      yield* command.execute({
        name: "grill-me",
        invocation: { sessionID, prompt: { text: "eu aprovo implementação" }, delivery: "steer" },
      })
      expect(prompts[0].text).toContain("Status: approved")
    }),
  )
})
