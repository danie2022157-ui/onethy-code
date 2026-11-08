// Automatically integrate native OnethyCode personalizations during an OnethyCode update.
// Never runs in ordinary development/CI installations or a different checkout.
// Does not register user-facing commands or execute third-party scripts.
import { resolve } from "node:path"
import { syncOnethyCustomizations } from "../packages/cli/src/services/onethy-customizations.mjs"

const root = process.env.ONETHY_INSTALL_ROOT
const isOnethy = process.env.OMNICODE_ACTIVE === "1" || process.env.ONETHY_ACTIVE === "1"
if (root && isOnethy && resolve(root) === resolve(process.cwd())) {
  try {
    const report = await syncOnethyCustomizations({
      global: true,
      // Never import OnethyCode assets into another product's config directory.
      globalDir: process.env.OMNICODE_CONFIG_DIR,
      sourceDir: process.env.ONETHY_CUSTOMIZATION_SOURCE_DIR || undefined,
      install: true,
    })
    console.info("OnethyCode personalizations:", report.installed, "installed;", report.existing,
      "already present;", report.pending, "reference-only or disabled;", report.rejected,
      "rejected; target:", report.target, "Removed obsolete MCPs:", report.obsoleteGeneratedMcpRemoved ?? 0)
  } catch (error) {
    console.warn("OnethyCode personalization sync unavailable:", error instanceof Error ? error.message : String(error))
    // Do not undo a successful software update when the external catalog is unavailable.
  }
}
