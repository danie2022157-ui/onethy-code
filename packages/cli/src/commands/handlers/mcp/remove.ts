import { EOL } from "node:os"
import path from "node:path"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { Effect } from "effect"
import { applyEdits, modify } from "jsonc-parser"
import { Global } from "@opencode/util/global"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { resolveConfigPath } from "./add"

export default Runtime.handler(
  Commands.commands.mcp.commands.remove,
  Effect.fn("cli.mcp.remove")(function* (input) {
    const global = yield* Global.Service
    const configPath = yield* Effect.promise(() => resolveConfigPath(input.global ? global.config : process.cwd()))
    yield* Effect.promise(() => write(configPath, input.name, undefined))
    process.stdout.write(`MCP server "${input.name}" removed from ${configPath}` + EOL)
  }),
)

async function write(configPath: string, name: string, server: unknown) {
  const text = await readFile(configPath, "utf8").catch((error) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return "{}"
    throw error
  })
  const edits = modify(text, ["mcp", "servers", name], server, {
    formattingOptions: { tabSize: 2, insertSpaces: true },
  })
  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, applyEdits(text, edits))
}
