import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261121084118_slimy_secret_warriors",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`session_review\` (
          \`session_id\` text NOT NULL,
          \`file\` text NOT NULL,
          \`status\` text NOT NULL,
          \`start_snapshot\` text NOT NULL,
          \`end_snapshot\` text NOT NULL,
          \`version\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`session_review_pk\` PRIMARY KEY(\`session_id\`, \`file\`),
          CONSTRAINT \`fk_session_review_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
    })
  },
}

export default migration
