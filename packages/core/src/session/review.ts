export * as SessionReview from "./review.js"

import { and, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import path from "path"
import { FSUtil } from "@opencode/util/fs-util"
import { Location } from "../location.js"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Session } from "@opencode/schema/session"
import { AbsolutePath, RelativePath } from "../schema.js"
import { FileMutation } from "../file-mutation.js"
import { Database } from "../database/database.js"
import { Snapshot } from "../snapshot.js"
import { SessionReviewTable, SessionTable } from "./sql.js"

export interface Decision {
  readonly sessionID: Session.ID
  readonly file: RelativePath
  readonly status: "keep" | "reject"
  /** Snapshot captured before the reviewed step. */
  readonly startSnapshot: Snapshot.ID
  /** Snapshot captured after the reviewed step; also the verified reviewed state. */
  readonly endSnapshot: Snapshot.ID
  /** CAS token written at persist time; supply the last-read version when overwriting to detect stale writes. */
  readonly version: number
  readonly timeCreated: number
  readonly timeUpdated: number
}

export interface DecideInput {
  readonly sessionID: Session.ID
  readonly file: RelativePath
  readonly decision: "keep" | "reject"
  /** Snapshot captured before the reviewed step. */
  readonly startSnapshot: Snapshot.ID
  /** Snapshot captured after the reviewed step; also the verified reviewed state. */
  readonly endSnapshot: Snapshot.ID
  /**
   * Expected current version of the decision row, or `undefined` when there is
   * no existing row. A mismatch rejects the write so a stale decision cannot
   * silently overwrite a newer review state.
   */
  readonly expectVersion?: number
}

export class ReviewError extends Schema.TaggedError<ReviewError>()("SessionReview.Error", {
  message: Schema.String,
}) {}

export interface Interface {
  readonly list: (sessionID: Session.ID) => Effect.Effect<Decision[]>
  readonly decide: (input: DecideInput) => Effect.Effect<Decision, ReviewError | Snapshot.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionReview") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const fs = yield* FSUtil.Service
    const snapshots = yield* Snapshot.Service
    const mutation = yield* FileMutation.Service
    const location = yield* Location.Service

    const rootDir = yield* fs.resolve(location.project.directory).pipe(Effect.orDie)

    const resolveReviewFile = Effect.fn("SessionReview.resolveReviewFile")(function* (file: RelativePath) {
      const resolved = AbsolutePath.make(path.resolve(rootDir, String(file)))
      const real = yield* fs.resolve(resolved).pipe(Effect.orDie)
      if (!FSUtil.contains(rootDir, real)) {
        return yield* Effect.fail(new ReviewError({ message: `File escapes project: ${String(file)}` }))
      }
      return real
    })

    /** Confirm the file truly belongs to the start->end diff observed at review time. */
    const confirmFileInDiff = Effect.fn("SessionReview.confirmFileInDiff")(
      function* (from: Snapshot.ID, to: Snapshot.ID, file: RelativePath) {
        const changed = yield* snapshots.files({ from, to })
        if (!changed.includes(file)) {
          return yield* Effect.fail(
            new ReviewError({ message: `File not part of reviewed change set: ${String(file)}` }),
          )
        }
      },
    )

    const list = Effect.fn("SessionReview.list")(function* (sessionID: Session.ID) {
      const rows = yield* db
        .select()
        .from(SessionReviewTable)
        .where(eq(SessionReviewTable.session_id, sessionID))
        .all()
        .pipe(Effect.orDie)
      return rows.map(toDecision)
    })

    const decide = Effect.fn("SessionReview.decide")(function* (input: DecideInput) {
      // Validate the session belongs to the current location/project before persistence.
      const session = yield* db
        .select({ id: SessionTable.id, project_id: SessionTable.project_id })
        .from(SessionTable)
        .where(eq(SessionTable.id, input.sessionID))
        .get()
        .pipe(Effect.orDie)
      if (!session) {
        return yield* Effect.fail(new ReviewError({ message: `Session not found: ${input.sessionID}` }))
      }
      if (session.project_id !== location.project.id) {
        return yield* Effect.fail(
          new ReviewError({ message: `Session ${input.sessionID} does not belong to current project` }),
        )
      }

      const fileReal = yield* resolveReviewFile(input.file)
      const where = and(eq(SessionReviewTable.session_id, input.sessionID), eq(SessionReviewTable.file, input.file))
      const result = yield* mutation.withLock([fileReal])(
        Effect.gen(function* () {
          // Review decisions and filesystem restores share one per-file transaction lock.
          // Read the row only after acquiring it so expectVersion is checked against the
          // latest decision, not a stale value observed before waiting.
          const existing = yield* db
            .select()
            .from(SessionReviewTable)
            .where(where)
            .get()
            .pipe(Effect.orDie)

          if (existing && (input.expectVersion === undefined || existing.version !== input.expectVersion)) {
            return yield* Effect.fail(
              new ReviewError({
                message: `Review decision conflict for ${String(input.file)}: expected ${input.expectVersion ?? "no existing decision"}, current version ${existing.version}`,
              }),
            )
          }
          if (!existing && input.expectVersion !== undefined) {
            return yield* Effect.fail(
              new ReviewError({ message: `Review decision conflict for ${String(input.file)}: decision no longer exists` }),
            )
          }

          yield* confirmFileInDiff(input.startSnapshot, input.endSnapshot, input.file)
          const now = Date.now()
          const nextVersion = (existing?.version ?? 0) + 1
          const values = {
            status: input.decision,
            start_snapshot: String(input.startSnapshot),
            end_snapshot: String(input.endSnapshot),
            time_updated: now,
            version: nextVersion,
          }
          const persist = Effect.gen(function* () {
            if (existing) {
              const updated = yield* db
                .update(SessionReviewTable)
                .set(values)
                .where(
                  and(
                    eq(SessionReviewTable.session_id, input.sessionID),
                    eq(SessionReviewTable.file, input.file),
                    eq(SessionReviewTable.version, input.expectVersion!),
                  ),
                )
                .returning({ version: SessionReviewTable.version })
                .all()
                .pipe(Effect.orDie)
              if (updated.length === 0) {
                return yield* Effect.fail(new ReviewError({ message: `Review decision conflict for ${String(input.file)}` }))
              }
              return
            }

            const inserted = yield* db
              .insert(SessionReviewTable)
              .values({
                session_id: input.sessionID,
                file: input.file,
                ...values,
                time_created: now,
              })
              .onConflictDoNothing({ target: [SessionReviewTable.session_id, SessionReviewTable.file] })
              .returning({ version: SessionReviewTable.version })
              .all()
              .pipe(Effect.orDie)
            if (inserted.length === 0) {
              return yield* Effect.fail(new ReviewError({ message: `Review decision conflict for ${String(input.file)}` }))
            }
          })

          if (input.decision === "reject") {
            const current = yield* snapshots.capture()
            if (!current) {
              return yield* Effect.fail(new ReviewError({ message: "Current snapshot is unavailable" }))
            }
            // Compare snapshot paths before restoring; Snapshot.files is not a raw-byte read.
            const changed = yield* snapshots.files({ from: input.endSnapshot, to: current })
            if (changed.includes(input.file)) {
              return yield* Effect.fail(
                new ReviewError({ message: `File changed since review: ${String(input.file)}` }),
              )
            }
            // Acquire CAS (persist) before any disk restore, inside the per-file lock.
            yield* persist
            yield* snapshots.restore({ files: new Map([[input.file, input.startSnapshot]]) }).pipe(
              Effect.catch((error) =>
                Effect.gen(function* () {
                  const row = yield* db
                    .select()
                    .from(SessionReviewTable)
                    .where(where)
                    .get()
                    .pipe(Effect.orDie)
                  if (!row || row.version !== nextVersion) return yield* Effect.fail(error)
                  if (existing) {
                    yield* db
                      .update(SessionReviewTable)
                      .set({
                        status: existing.status,
                        start_snapshot: existing.start_snapshot,
                        end_snapshot: existing.end_snapshot,
                        version: nextVersion,
                        time_created: existing.time_created,
                        time_updated: now,
                      })
                      .where(
                        and(
                          eq(SessionReviewTable.session_id, input.sessionID),
                          eq(SessionReviewTable.file, input.file),
                          eq(SessionReviewTable.version, nextVersion),
                        ),
                      )
                      .run()
                      .pipe(Effect.orDie)
                  } else {
                    yield* db
                      .delete(SessionReviewTable)
                      .where(
                        and(
                          eq(SessionReviewTable.session_id, input.sessionID),
                          eq(SessionReviewTable.file, input.file),
                          eq(SessionReviewTable.version, nextVersion),
                        ),
                      )
                      .run()
                      .pipe(Effect.orDie)
                  }
                  return yield* Effect.fail(error)
                }),
              ),
            )
          } else {
            yield* persist
          }

          const row = yield* db.select().from(SessionReviewTable).where(where).get().pipe(Effect.orDie)
          if (!row) return yield* Effect.fail(new ReviewError({ message: "Review decision was not persisted" }))
          return toDecision(row)
        }),
      )
      return result
    })

    return Service.of({ list, decide })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Database.node, Snapshot.node, FileMutation.node, Location.node, FSUtil.node],
})

function toDecision(row: typeof SessionReviewTable.$inferSelect): Decision {
  return {
    sessionID: row.session_id as Session.ID,
    file: RelativePath.make(row.file),
    status: row.status,
    startSnapshot: Snapshot.ID.make(row.start_snapshot),
    endSnapshot: Snapshot.ID.make(row.end_snapshot),
    version: row.version,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

export { Schema } from "effect"
