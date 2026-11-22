import { describe, expect } from "bun:test"
import { and, eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Project } from "@opencode/core/project"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Database } from "@opencode/core/database/database"
import { Bus } from "@opencode/core/bus"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionStore } from "@opencode/core/session/store"
import { SessionReview } from "@opencode/core/session/review"
import { Snapshot } from "@opencode/core/snapshot"
import { FileMutation } from "@opencode/core/file-mutation"
import { FSUtil } from "@opencode/util/fs-util"
import { Location } from "@opencode/core/location"
import { AbsolutePath, RelativePath } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import { Event } from "@opencode/schema/event"
import { SessionEvent } from "@opencode/schema/session-event"
import { Snapshot as SnapshotSchema } from "@opencode/schema/snapshot"
import { ProjectTable } from "@opencode/core/project/sql"
import { SessionReviewTable } from "@opencode/core/session/sql"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const projectID = Project.ID.make("prj_review_test")

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      SessionReview.node,
      Snapshot.node,
      FileMutation.node,
      Location.node,
      FSUtil.node,
    ]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      Snapshot.node.replace(
        Layer.succeed(
          Snapshot.Service,
          Snapshot.Service.of({
            transform: () => Effect.succeed({ dispose: Effect.void }),
            reload: () => Effect.void,
            capture: () => Effect.succeed(SnapshotSchema.ID.make("current")),
            files: ({ from, to }) => {
              if (
                from === SnapshotSchema.ID.make("restore_failure") &&
                to === SnapshotSchema.ID.make("end_snap_restore")
              )
                return Effect.succeed([RelativePath.make("src/restore.ts")])
              if (
                from === SnapshotSchema.ID.make("start_snap_2") &&
                to === SnapshotSchema.ID.make("end_snap_2")
              )
                return Effect.succeed([RelativePath.make("src/other.ts")])
              if (
                from === SnapshotSchema.ID.make("start_snap_1") &&
                to === SnapshotSchema.ID.make("end_snap_1")
              )
                return Effect.succeed([RelativePath.make("src/test.ts")])
              if (
                from === SnapshotSchema.ID.make("start_snap_3") &&
                to === SnapshotSchema.ID.make("end_snap_3")
              )
                return Effect.succeed([RelativePath.make("src/update.ts")])
              if (
                from === SnapshotSchema.ID.make("start_snap_4") &&
                to === SnapshotSchema.ID.make("end_snap_4")
              )
                return Effect.succeed([RelativePath.make("src/conflict.ts")])
              if (
                from === SnapshotSchema.ID.make("previous_start") &&
                to === SnapshotSchema.ID.make("previous_end")
              )
                return Effect.succeed([RelativePath.make("src/restore-existing.ts")])
              if (
                from === SnapshotSchema.ID.make("start_snap_iso") &&
                to === SnapshotSchema.ID.make("end_snap_iso")
              )
                return Effect.succeed([RelativePath.make("src/shared.ts")])
              if (
                from === SnapshotSchema.ID.make("restore_failure") &&
                to === SnapshotSchema.ID.make("end_snap_restore_existing")
              )
                return Effect.succeed([RelativePath.make("src/restore-existing.ts")])
              if (
                from === SnapshotSchema.ID.make("start_snap_missing") &&
                to === SnapshotSchema.ID.make("end_snap_missing")
              )
                return Effect.succeed([RelativePath.make("src/missing.ts")])
              return Effect.succeed([])
            },
            diff: () => Effect.succeed([]),
            restore: ({ files }) =>
              Effect.succeed([...files.values()][0]).pipe(
                Effect.flatMap((snapshot) =>
                  snapshot === SnapshotSchema.ID.make("restore_failure")
                    ? Effect.fail(new Snapshot.Error({ operation: "restore", message: "restore failed" }))
                    : Effect.void,
                ),
              ),
          }),
        ),
      ),
      FileMutation.node.replace(
        Layer.succeed(
          FileMutation.Service,
          FileMutation.Service.of({
            withLock: (_targets) => <A, E, R>(effect: Effect.Effect<A, E, R>) => effect,
            write: () => Effect.succeed({ operation: "write", target: "", resource: "", existed: false }),
            writeTextPreservingBom: () =>
              Effect.succeed({ operation: "write", target: "", resource: "", existed: false }),
          }),
        ),
      ),
      Location.node.replace(
        Layer.succeed(Location.Service, {
          directory: AbsolutePath.make("/project"),
          project: { id: projectID, directory: AbsolutePath.make("/project"), canonical: AbsolutePath.make("/project") },
          workspaceID: undefined,
          vcs: undefined,
        }),
      ),
    ],
  ),
)

const setupSession = Effect.gen(function* () {
  const db = yield* Database.Service
  const bus = yield* Bus.Service
  yield* db.db.insert(ProjectTable).values({ id: projectID, worktree: AbsolutePath.make("/project"), sandboxes: [] }).run()
  yield* db.db.run(`CREATE TABLE IF NOT EXISTS \`session_review\` (
    \`session_id\` text NOT NULL,
    \`file\` text NOT NULL,
    \`status\` text NOT NULL CHECK (\`status\` IN ('keep', 'reject')),
    \`start_snapshot\` text NOT NULL,
    \`end_snapshot\` text NOT NULL,
    \`version\` integer NOT NULL,
    \`time_created\` integer NOT NULL,
    \`time_updated\` integer NOT NULL,
    CONSTRAINT \`session_review_pk\` PRIMARY KEY(\`session_id\`, \`file\`),
    CONSTRAINT \`fk_session_review_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
  )`)
  yield* db.db.run(`CREATE INDEX IF NOT EXISTS \`session_review_session_id_idx\` ON \`session_review\` (\`session_id\`)`)
  const sessionID = Session.ID.make(`ses_review_${Event.ID.create()}`)
  yield* bus.publish(SessionEvent.Created, {
    sessionID,
    projectID,
    location: { directory: AbsolutePath.make("/project") },
    slug: "review-test",
    version: "test",
  })
  return sessionID
})

describe("SessionReview", () => {
  it.effect("persists keep decision and lists it", () =>
    Effect.gen(function* () {
      const sessionID = yield* setupSession
      const review = yield* SessionReview.Service
      const startSnap = SnapshotSchema.ID.make("start_snap_1")
      const endSnap = SnapshotSchema.ID.make("end_snap_1")
      const file = RelativePath.make("src/test.ts")

      const decided = yield* review.decide({
        sessionID,
        file,
        decision: "keep",
        startSnapshot: startSnap,
        endSnapshot: endSnap,
      })
      expect(decided.status).toBe("keep")
      expect(decided.file).toBe(file)
      expect(decided.version).toBe(1)

      const listed = yield* review.list(sessionID)
      expect(listed).toHaveLength(1)
      expect(listed[0]?.status).toBe("keep")
    }),
  )

  it.effect("persists reject decision and lists it", () =>
    Effect.gen(function* () {
      const sessionID = yield* setupSession
      const review = yield* SessionReview.Service
      const startSnap = SnapshotSchema.ID.make("start_snap_2")
      const endSnap = SnapshotSchema.ID.make("end_snap_2")
      const file = RelativePath.make("src/other.ts")

      const decided = yield* review.decide({
        sessionID,
        file,
        decision: "reject",
        startSnapshot: startSnap,
        endSnapshot: endSnap,
      })
      expect(decided.status).toBe("reject")
      expect(decided.version).toBe(1)

      const listed = yield* review.list(sessionID)
      expect(listed).toHaveLength(1)
      expect(listed[0]?.status).toBe("reject")
    }),
  )

  it.effect("updates existing decision and increments version", () =>
    Effect.gen(function* () {
      const sessionID = yield* setupSession
      const review = yield* SessionReview.Service
      const startSnap = SnapshotSchema.ID.make("start_snap_3")
      const endSnap = SnapshotSchema.ID.make("end_snap_3")
      const file = RelativePath.make("src/update.ts")

      const first = yield* review.decide({
        sessionID,
        file,
        decision: "keep",
        startSnapshot: startSnap,
        endSnapshot: endSnap,
      })
      expect(first.version).toBe(1)

      const second = yield* review.decide({
        sessionID,
        file,
        decision: "reject",
        startSnapshot: startSnap,
        endSnapshot: endSnap,
        expectVersion: 1,
      })
      expect(second.status).toBe("reject")
      expect(second.version).toBe(2)
    }),
  )

  it.effect("rejects stale expectVersion with conflict error", () =>
    Effect.gen(function* () {
      const sessionID = yield* setupSession
      const review = yield* SessionReview.Service
      const startSnap = SnapshotSchema.ID.make("start_snap_4")
      const endSnap = SnapshotSchema.ID.make("end_snap_4")
      const file = RelativePath.make("src/conflict.ts")

      yield* review.decide({
        sessionID,
        file,
        decision: "keep",
        startSnapshot: startSnap,
        endSnapshot: endSnap,
      })
      yield* review.decide({
        sessionID,
        file,
        decision: "keep",
        startSnapshot: startSnap,
        endSnapshot: endSnap,
        expectVersion: 1,
      })

      // The diff is valid, so rejection must fail specifically at the stale-version CAS.
      const result = yield* Effect.result(review.decide({
        sessionID,
        file,
        decision: "reject",
        startSnapshot: startSnap,
        endSnapshot: endSnap,
        expectVersion: 1,
      }))
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        expect(result.failure.message).toContain("current version 2")
      }
    }),
  )

  it.effect("rejects an expected version when its decision row was deleted", () =>
    Effect.gen(function* () {
      const sessionID = yield* setupSession
      const review = yield* SessionReview.Service
      const db = yield* Database.Service
      const file = RelativePath.make("src/missing.ts")
      const startSnapshot = SnapshotSchema.ID.make("start_snap_missing")
      const endSnapshot = SnapshotSchema.ID.make("end_snap_missing")

      yield* review.decide({
        sessionID,
        file,
        decision: "keep",
        startSnapshot,
        endSnapshot,
      })
      yield* db.db
        .delete(SessionReviewTable)
        .where(and(eq(SessionReviewTable.session_id, sessionID), eq(SessionReviewTable.file, file)))
        .run()

      const result = yield* Effect.result(
        review.decide({
          sessionID,
          file,
          decision: "keep",
          startSnapshot,
          endSnapshot,
          expectVersion: 1,
        }),
      )
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        expect(result.failure.message).toContain("decision no longer exists")
      }
    }),
  )

  it.effect("returns empty list for session with no decisions", () =>
    Effect.gen(function* () {
      const sessionID = yield* setupSession
      const review = yield* SessionReview.Service

      const listed = yield* review.list(sessionID)
      expect(listed).toHaveLength(0)
    }),
  )

  it.effect("rejects path traversal escape", () =>
    Effect.gen(function* () {
      const sessionID = yield* setupSession
      const review = yield* SessionReview.Service
      const startSnap = SnapshotSchema.ID.make("start_snap_5")
      const endSnap = SnapshotSchema.ID.make("end_snap_5")
      const file = RelativePath.make("../outside.ts")

      expect(yield* Effect.result(review.decide({
          sessionID,
          file,
          decision: "keep",
          startSnapshot: startSnap,
          endSnapshot: endSnap,
        }))).toMatchObject({ _tag: "Failure" })
      const result = yield* Effect.result(review.list(sessionID))
      expect(result._tag).toBe("Success")
    }),
  )

  it.effect("rolls back a new reject decision when snapshot restore fails", () =>
    Effect.gen(function* () {
      const sessionID = yield* setupSession
      const review = yield* SessionReview.Service
      const startSnap = SnapshotSchema.ID.make("restore_failure")
      const endSnap = SnapshotSchema.ID.make("end_snap_restore")
      const file = RelativePath.make("src/restore.ts")

      expect(
        yield* Effect.result(
          review.decide({
            sessionID,
            file,
            decision: "reject",
            startSnapshot: startSnap,
            endSnapshot: endSnap,
          }),
        ),
      ).toMatchObject({ _tag: "Failure" })

      expect(yield* review.list(sessionID)).toHaveLength(0)
    }),
  )

  it.effect("restores the prior decision when an existing reject restore fails", () =>
    Effect.gen(function* () {
      const sessionID = yield* setupSession
      const review = yield* SessionReview.Service
      const file = RelativePath.make("src/restore-existing.ts")

      const previous = yield* review.decide({
        sessionID,
        file,
        decision: "keep",
        startSnapshot: SnapshotSchema.ID.make("previous_start"),
        endSnapshot: SnapshotSchema.ID.make("previous_end"),
      })
      const result = yield* Effect.result(
        review.decide({
          sessionID,
          file,
          decision: "reject",
          startSnapshot: SnapshotSchema.ID.make("restore_failure"),
          endSnapshot: SnapshotSchema.ID.make("end_snap_restore_existing"),
          expectVersion: previous.version,
        }),
      )

      expect(result._tag).toBe("Failure")
      const [decision] = yield* review.list(sessionID)
      expect(decision).toMatchObject({ status: "keep", version: previous.version + 1 })
    }),
  )

  it.effect("isolates decisions by session", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const database = yield* Database.Service
      const directory = AbsolutePath.make("/project")
      yield* database.db.insert(ProjectTable).values({ id: projectID, worktree: directory, sandboxes: [] }).run()
      const sessionID1 = Session.ID.make("ses_iso_1")
      const sessionID2 = Session.ID.make("ses_iso_2")

      yield* bus.publish(SessionEvent.Created, {
        sessionID: sessionID1,
        projectID,
        location: { directory },
        slug: "iso-1",
        version: "test",
      })
      yield* bus.publish(SessionEvent.Created, {
        sessionID: sessionID2,
        projectID,
        location: { directory },
        slug: "iso-2",
        version: "test",
      })

      const review = yield* SessionReview.Service
      const startSnap = SnapshotSchema.ID.make("start_snap_iso")
      const endSnap = SnapshotSchema.ID.make("end_snap_iso")
      const file = RelativePath.make("src/shared.ts")

      yield* review.decide({
        sessionID: sessionID1,
        file,
        decision: "keep",
        startSnapshot: startSnap,
        endSnapshot: endSnap,
      })

      const listed1 = yield* review.list(sessionID1)
      const listed2 = yield* review.list(sessionID2)

      expect(listed1).toHaveLength(1)
      expect(listed2).toHaveLength(0)
    }),
  )
})

