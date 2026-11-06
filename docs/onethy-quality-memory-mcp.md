# OnethyCode: Verified Quality, Hybrid Memory & Safe MCP Cache

New features reuse OnethyCode's existing architecture. Deployment-specific production certification still requires testing real providers, MCP accounts, and representative workloads.

## Verified model quality routing

OnethyCode automatically selects models using actual outcomes from **independently verified benchmark tasks**, not model-generated completion claims. All evidence is stored locally outside Git, per workspace. It retains only hashed task IDs, model IDs, category, pass/fail, USD cost, run duration and timestamp, with 90-day retention.

Trusted CI or reviewed benchmark data can be imported with:

~~~powershell
bun --cwd packages/core script/quality-ingest.ts "C:\path\to\workspace" "C:\benchmarks\verified.json"
~~~

Expected JSON format:

~~~json
[
  {
    "taskId": "fix-build-123",
    "model": "provider/model-name",
    "category": "code_implementation",
    "verified": true,
    "costUsd": 0.23,
    "durationMs": 40800,
    "verifiedBy": "ci:build-regression-v1"
  }
]
~~~

The verifier must be independent and supply genuine results including total costs and retries. Do not invent results. Supported categories: fast_explore, external_research, deep_architecture, code_implementation, security_review, orchestration.

Restart the OnethyCode service after import. A quality override is activated only when two allowed, available models each have at least eight independently verified cases in the task category, both reach at least 90% success, and the preferred model remains within three percentage points of the best success rate. Then the lower observed **cost per verified completion** wins. Existing model cooldown, model allowlists, explicit model choices, and agent model configuration retain precedence.

Opt out with ONETHY_QUALITY_ROUTER=off at startup. This is cautious empirical routing, not a trained neural reward model or a statistical guarantee from eight samples.

## Memory search

Search the approved project memory files with:

~~~text
omni_memory action=search scope=project query="architecture and database decisions" limit=5
~~~

The search returns relevant short sections from only the four known project memory-bank documents. The global scope reads the three approved global memory documents separately. It excludes arbitrary filenames and rejects symlinks. There is no indexing of hidden files, credentials or unrelated workspaces.

When local Ollama and nomic-embed-text are running, hybrid retrieval combines embeddings with lexical matching. If Ollama is unavailable, deterministic lexical search works offline. No remote endpoint is used for memory embeddings. Vector caches are private, workspace-scoped and content-hashed.

Full-document reads and memory updates are unchanged. Retrieval is on demand to avoid unnecessary context injections and preserve prompt-cache effectiveness.

## MCP discovery cache

A short-lived tool catalog can be restored for **already authorized local stdio MCPs** that were successfully connected earlier. This avoids starting rarely used local MCP processes just to rediscover tools.

- Only local stdio MCPs are eligible. Remote OAuth and header-authenticated servers always perform their normal handshakes.
- Cached schemas expire after 30 minutes and are invalidated by changes to the MCP configuration, including environment variables.
- Cache fingerprint uses HMAC with a random local salt. Neither command line nor environment values are stored.
- Cache stores tool names, descriptions and input/output JSON schemas only. It never stores tool arguments, responses, API keys, credentials or tokens.
- The restored catalog is a discovery hint. Before executing a cached tool, OnethyCode connects the server again and verifies that the tool is still advertised by the **live** MCP connection.
- Existing permission checks remain in place. Disabled or removed servers are not enabled by the cache; removal invalidates the cache.
- Cache errors never prevent startup; normal discovery remains the fallback.

Disable only the cache with ONETHY_MCP_CATALOG_CACHE=off, or all adaptive MCP behavior with ONETHY_MCP_AUTONOMY=off.

## Testing and production gate

~~~bash
bun install --frozen-lockfile
bun --cwd packages/core test test/model-outcomes.test.ts test/memory-retrieval.test.ts test/mcp-catalog-cache.test.ts
bun --cwd packages/core run typecheck:tsc
bun --cwd packages/cli run typecheck:tsc
~~~

Run tests on Ubuntu and Windows, including PowerShell/WSL launch, local MCP restarts, disabled MCP, real OAuth expiry, and provider usage reporting. Import independently verified coding benchmark results and compare cost per **correct completed task**, quality and p95 latency with the existing efficiency-compare script. Deploy gradually with monitoring and rollback.

No AI tool, MCP cache, or unit test can prove every production integration is bug-free, nor guarantee a 20% cost reduction without measurements from the actual user workloads.
