import { describe, expect, test, afterEach } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { embeddingIndexPath, localEmbeddingIndex, parseEmbeddingIndex } from "../src/embedding-index"

const directories: string[] = []
afterEach(async () => Promise.all(directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))))

describe("local embedding index", () => {
  const hash = createHash("sha256").update("file content").digest("hex")
  test("uses a private per-workspace cache, with model and hash invalidation", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "onethy-embedding-"))
    directories.push(root)
    const index = await localEmbeddingIndex(path.join(root, "first"), "nomic-embed-text", root)
    await index.update([{ file: "src/index.ts", contentHash: hash, mtime: 1, bytes: 15, vector: [0.1, 0.8] }], ["src/index.ts"])
    expect(index.get("src/index.ts", hash)).toEqual([0.1, 0.8])
    expect(index.get("src/index.ts", "bad hash")).toBeUndefined()
    const content = JSON.parse(await fs.readFile(embeddingIndexPath(path.join(root, "first"), root), "utf8"))
    expect(content.entries[0].file).toBe("src/index.ts")
    expect(content.entries[0].vector).toEqual([0.1, 0.8])
    expect(embeddingIndexPath(path.join(root, "second"), root)).not.toBe(embeddingIndexPath(path.join(root, "first"), root))
    expect(parseEmbeddingIndex(content, "different-model")).toEqual([])
  })

  test("rejects malicious paths, invalid vectors and corrupt formats", () => {
    const records = parseEmbeddingIndex({
      version: 1, model: "test", entries: [
        { file: "../escape", contentHash: hash, mtime: 1, bytes: 4, vector: [1] },
        { file: "file.ts", contentHash: hash, mtime: 1, bytes: 4, vector: [NaN] },
      ],
    }, "test")
    expect(records).toEqual([])
    expect(parseEmbeddingIndex({ version: 2, model: "test", entries: [] }, "test")).toEqual([])
  })
})
