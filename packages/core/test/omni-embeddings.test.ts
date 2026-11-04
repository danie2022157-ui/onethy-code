import { describe, expect, test } from "bun:test"
import { OmniEmbeddings } from "../src/omni-embeddings.js"

describe("Local semantic search primitives", () => {
  test("cosine ranking respects vector dimension, alignment and opposition", () => {
    expect(OmniEmbeddings.similarity([1, 0], [1, 0])).toBe(1)
    expect(OmniEmbeddings.similarity([1, 0], [0, 1])).toBe(0)
    expect(OmniEmbeddings.similarity([1, 0], [-1, 0])).toBe(-1)
    expect(OmniEmbeddings.similarity([], [])).toBe(0)
    expect(OmniEmbeddings.similarity([1], [1, 0])).toBe(0)
  })
  test("never indexes generated, hidden, private or credential files", () => {
    expect(OmniEmbeddings.sourceAllowed("src/auth/login.ts")).toBe(true)
    expect(OmniEmbeddings.sourceAllowed("src/component/Button.tsx")).toBe(true)
    expect(OmniEmbeddings.sourceAllowed(".env")).toBe(false)
    expect(OmniEmbeddings.sourceAllowed("src/.private/key.ts")).toBe(false)
    expect(OmniEmbeddings.sourceAllowed("dist/generated.ts")).toBe(false)
    expect(OmniEmbeddings.sourceAllowed("src/secret-manager.ts")).toBe(false)
    expect(OmniEmbeddings.sourceAllowed("node_modules/leftpad/index.js")).toBe(false)
  })
})
