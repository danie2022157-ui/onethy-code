# AI SDK dependency upgrade scan

**Checked:** 2026-10-30  
**Scope:** AI SDK-related package declarations in the workspace, with particular attention to the root and `packages/core/package.json`; the package implementation, its provider-support libraries, and AI SDK transitive dependencies are called out separately. “Eligible” means a published stable release whose major version is unchanged; no major upgrades are proposed. No dependencies have been changed.

## Findings

The direct AI SDK-related declarations are:

| Dependency | Current version and declaration | Latest eligible version | Update notes / source |
|---|---|---|---|
| `@ai-sdk/provider` | `3.0.19` — `packages/core` runtime; `3.0.8` — `packages/plugin` runtime | Core: no update; plugin: `3.0.19` | Same-major newest stable is `3.0.19`; newer major versions are excluded. |
| `@ai-sdk/provider-utils` | `4.0.62` — `packages/core` runtime | `4.0.63` | Same-major newest stable is `4.0.63`; newer major versions are excluded. |
| `@ai-sdk/openai-compatible` | `2.0.41` — `packages/core` dev dependency; exact-version Bun patch in root `package.json` | `2.0.88` | Patch-only update. Upstream `2.0.61` already contains the local patch fix; `2.0.88` depends on provider `3.0.19` and provider-utils `4.0.63`. |
| `gitlab-ai-provider` | `6.23.1` — `packages/core` runtime | No same-major upgrade (`6.23.1` is latest) | Current pin already includes 6.23.1’s fix for Duo Agent Platform on self-managed GitLab instances. |

The lockfile also shows `@ai-sdk/openai-compatible@2.0.41` bringing its own nested `@ai-sdk/provider@3.0.8` and `@ai-sdk/provider-utils@4.0.23`. These are transitive resolutions, not additional direct declarations; the report tracks the package that owns those exact dependency pins.

`@ai-sdk/openai-compatible` has a same-major patch update available: `2.0.41 → 2.0.88` (latest v2; `3.0.81` is the newer major and excluded). Intervening releases fix tool-only assistant messages, empty roles, streaming tool-call fragments/IDs (including a security fix to avoid acting on prematurely parseable partial JSON), SSE errors, truncated streams and token accounting; add support for array content and URL-based image responses; and improve reasoning order and lazy schema validation. **Patch interaction:** the repository's exact `2.0.41` patch changes streamed error handling, but that fix shipped upstream in `2.0.61`, so it is present in `2.0.88`. If a future upgrade is undertaken, remove the obsolete exact-version patch mapping/file rather than carry it forward. Version `2.0.88` also pins `@ai-sdk/provider@3.0.19` and `@ai-sdk/provider-utils@4.0.63`; check lockfile resolution and tests together. [npm metadata](https://registry.npmjs.org/@ai-sdk%2Fopenai-compatible) · [official v6 changelog](https://github.com/vercel/ai/blob/release-v6.0/packages/openai-compatible/CHANGELOG.md) · [2.0.58 partial-tool-call safety fix](https://github.com/vercel/ai/blob/release-v6.0/packages/openai-compatible/CHANGELOG.md#2058) · [2.0.61 patch fix](https://github.com/vercel/ai/blob/release-v6.0/packages/openai-compatible/CHANGELOG.md#2061) · [source commit](https://github.com/vercel/ai/commit/94fda5cb23834a32b885f02e72137eec27efc7a2) · [Bun patch docs](https://bun.com/docs/pm/cli/patch)

The same-major `@ai-sdk/provider` release `3.0.19` is already installed by Core, but Plugin can move from `3.0.8` to `3.0.19`. Releases since 3.0.8 add audio generation, video input/reference and aspect-ratio options, improve image-result retry classification, preserve file URI/MIME information, and restore raw OpenAI custom-tool input deltas for streaming consumers. [npm metadata](https://registry.npmjs.org/@ai-sdk%2fprovider) · [3.0.19 release notes](https://github.com/vercel/ai/releases/tag/%40ai-sdk/provider%403.0.19) · [3.0.16 retry fix](https://github.com/vercel/ai/releases/tag/%40ai-sdk/provider%403.0.16) · [3.0.12 audio capability](https://github.com/vercel/ai/releases/tag/%40ai-sdk/provider%403.0.12) · [3.0.13 video inputs](https://github.com/vercel/ai/releases/tag/%40ai-sdk/provider%403.0.13) · [3.0.15 adaptive aspect ratio](https://github.com/vercel/ai/releases/tag/%40ai-sdk/provider%403.0.15)

`@ai-sdk/provider-utils` can move from `4.0.62` to `4.0.63`. This release uses native `Buffer` base64 encoding when available, avoiding a chunked encoding path and intermediate allocations. **Behavior caveat:** encoding a `Uint8Array` backed by a detached `ArrayBuffer` now throws `TypeError` in runtimes with `Buffer` instead of returning an empty string. [npm metadata](https://registry.npmjs.org/@ai-sdk%2fprovider-utils) · [4.0.63 release notes](https://github.com/vercel/ai/releases/tag/%40ai-sdk/provider-utils%404.0.63) · [implementing commit](https://github.com/vercel/ai/commit/28252da962a4723f2642bb09b23fdc151a097e70)

`gitlab-ai-provider@6.23.1` declares peers `@ai-sdk/provider >=3.0.0` and `@ai-sdk/provider-utils >=4.0.0`, satisfied by Core’s direct versions. Its 6.23.0 shared direct-access-token cache feature and 6.23.1 self-managed-instance fix are already included in the current pin. [Official changelog](https://gitlab.com/vglafirov/gitlab-ai-provider/-/blob/main/CHANGELOG.md) · [release history](https://gitlab.com/vglafirov/gitlab-ai-provider/-/releases) · [6.23.1 fix](https://gitlab.com/vglafirov/gitlab-ai-provider/-/commit/647e929) · [npm latest metadata](https://registry.npmjs.org/gitlab-ai-provider/latest)

### AI provider implementation support dependencies

These are direct dependencies of `packages/ai`, the workspace's provider implementation package. They are not Vercel AI SDK adapters, but are used for provider transport, auth, or signing. `aws4fetch` is also directly declared in `packages/console/app`.

| Dependency | Current version | Latest eligible version | Update notes / source |
|---|---:|---:|---|
| `@aws-sdk/credential-providers` | `3.1057.0` | `3.1160.0` | Deferred loading for aggregated providers and fixes to provider-chain memoization and disk-based login-token reads. |
| `@smithy/eventstream-codec` | `4.2.14` | `4.5.2` | API/module consolidation, CommonJS output and type/build updates; latest patch has no functional change. |
| `@smithy/util-utf8` | `4.2.2` | `4.5.2` | Same Smithy API/module consolidation and type/build updates; latest patch has no functional change. |
| `aws4fetch` | `1.0.20` — `packages/ai` and `packages/console/app` | No same-major upgrade (`1.0.20` is latest) | Current release caps DNS hostname labels at 63 characters. |
| `google-auth-library` | `10.5.0` | `10.9.1` | Fixes AWS credential URL loading; adds GDCH credentials and regional access-boundary support; improves ADC lookup and credential errors. |

The Smithy libraries can move from `4.2.14` / `4.2.2` to `4.5.2`. The intervening changes consolidate code into `core/serde` and `core/event-streams`, clean up exports, switch CommonJS output, and improve `isolatedModules` types; the latest release restores npm provenance and reports no functional change. [Event-stream codec changelog](https://github.com/smithy-lang/smithy-typescript/blob/main/packages/eventstream-codec/CHANGELOG.md) · [UTF-8 utility changelog](https://github.com/smithy-lang/smithy-typescript/blob/main/packages/util-utf8/CHANGELOG.md) · [npm metadata: eventstream-codec](https://registry.npmjs.org/%40smithy%2Feventstream-codec/latest) · [npm metadata: util-utf8](https://registry.npmjs.org/%40smithy%2Futil-utf8/latest)

`aws4fetch` is already at its latest `1.x` version (`1.0.20`); that release caps DNS hostname labels at 63 characters. [Official release notes](https://github.com/mhart/aws4fetch/releases/tag/v1.0.20) · [npm metadata](https://registry.npmjs.org/aws4fetch/latest)

`@aws-sdk/credential-providers` can move from `3.1057.0` to `3.1160.0`. Highlights include deferred loading in the credential-provider aggregator, `fromNodeProviderChain` memoization fixes, and disk login-token read fixes; `3.1160.0` itself is a version-only release. [npm metadata](https://registry.npmjs.org/@aws-sdk%2Fcredential-providers) · [AWS SDK v3 changelog](https://github.com/aws/aws-sdk-js-v3/blob/main/packages/credential-providers/CHANGELOG.md)

`google-auth-library` can move from `10.5.0` to `10.9.1`. Intervening releases fix AWS credential-URL loading, update Gaxios, add GDCH credentials and regional access-boundary support, and improve ADC well-known-file lookup and credential-loading errors. The registry's `latest` tag is `11.3.2`; that major is excluded. [npm metadata](https://registry.npmjs.org/google-auth-library) · [official changelog](https://github.com/googleapis/google-cloud-node/blob/main/core/packages/google-auth-library-nodejs/CHANGELOG.md)

### AI vendor SDKs available only transitively

`gitlab-ai-provider@6.23.1` currently resolves `openai@6.49.0` (range `^6.16.0`) and `@anthropic-ai/sdk@0.71.2` (range `^0.71.0`). Neither is declared directly in this workspace; updates are governed by the transitive range and lockfile, not project-level direct pins.

- `openai@6.49.0` is already the latest v6.0 release, so there is no eligible update. v7 is a major upgrade and is excluded (it also requires Node.js 22). [OpenAI SDK changelog](https://github.com/openai/openai-node/blob/master/CHANGELOG.md) · [v6.49.0 to v7.0.0 comparison](https://github.com/openai/openai-node/compare/v6.49.0...v7.0.0) · [GitLab provider metadata](https://registry.npmjs.org/gitlab-ai-provider/6.23.1)
- `@anthropic-ai/sdk@0.71.2` is already the latest patch allowed by `^0.71.0`; that range excludes `0.72.0` and higher. Releases 0.71.0–0.71.2 added Claude Opus 4.5 / tool-use features and fixed parsed-block behavior and catchability of stream errors. Although `0.137.0` is the latest published 0.x version, it is outside the provider's declared range and should not be forced in as a direct dependency. [Anthropic TypeScript SDK changelog](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/CHANGELOG.md) · [0.71.2 release](https://github.com/anthropics/anthropic-sdk-typescript/releases/tag/sdk-v0.71.2) · [0.137.0 release](https://github.com/anthropics/anthropic-sdk-typescript/releases/tag/sdk-v0.137.0) · [npm semver caret rules](https://github.com/npm/node-semver#caret-ranges-123-025-004)

## Requested examples not directly declared

The following package names were not found as direct dependencies in the workspace manifests inspected: `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, and `@openrouter/ai-sdk-provider`. They are therefore not listed as direct upgrade candidates. The internal workspace package `@opencode/ai` contains OpenAI, Anthropic, and OpenRouter provider implementations but is not the external Vercel SDK package `ai` and does not declare those adapters.

## Patch-only entries

The root `patchedDependencies` map also has manifest-only selectors for `@ai-sdk/google@3.0.73` and `@ai-sdk/mistral@3.0.51`. Neither has a matching entry in the lockfile's patch map or a package record in its dependency graph, so they are not active upgrade candidates.
