import type { RouteDefaultsInput } from "../route/client.js"
import { Auth } from "../route/auth.js"
import type { ProviderAuthOption } from "../route/auth-options.js"
import type { ProviderPackage } from "../provider-package.js"
import { ProviderConfigurationError, ProviderID, type ModelID } from "../schema/index.js"
import { AnthropicMessages } from "../protocols/anthropic-messages.js"
import { AnthropicCompatible } from "./anthropic-compatible.js"

export type AnthropicOptionsInput = AnthropicMessages.OptionsInput
export type AnthropicProviderOptionsInput = AnthropicMessages.ProviderOptionsInput
export type AnthropicThinkingInput = AnthropicMessages.ThinkingInput

export const id = ProviderID.make("anthropic")

export const routes = [AnthropicMessages.route]

export type Config = RouteDefaultsInput &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: AnthropicMessages.ProviderOptionsInput
  }

export type Settings = ProviderPackage.Settings &
  AnthropicMessages.ProviderOptionsInput &
  (
    | { readonly apiKey?: string; readonly authToken?: never }
    | { readonly apiKey?: never; readonly authToken?: string }
  ) & {
    readonly baseURL?: string
  }

function normalizeBaseURL(url?: string): string | undefined {
  if (!url) return undefined
  const trimmed = url.trim().replace(/\/+$/, "")
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`
}

const auth = (options: ProviderAuthOption<"optional">) => {
  if ("auth" in options && options.auth) return options.auth
  const key = "apiKey" in options ? options.apiKey : undefined
  return Auth.optional(key, "apiKey")
    .orElse(Auth.config("ANTHROPIC_AUTH_TOKEN"))
    .orElse(Auth.config("ANTHROPIC_API_KEY"))
    .pipe(Auth.header("x-api-key"))
}

export const configure = (input: Config = {}) => {
  const { apiKey: _, auth: _auth, baseURL, ...rest } = input
  const resolvedBaseURL =
    normalizeBaseURL(baseURL) ??
    normalizeBaseURL(process.env.ANTHROPIC_BASE_URL) ??
    AnthropicMessages.DEFAULT_BASE_URL
  const compatible = AnthropicCompatible.configure({
    ...rest,
    auth: auth(input),
    baseURL: resolvedBaseURL,
    provider: id,
  })
  return {
    id,
    model: (modelID: string | ModelID) => compatible.model(modelID),
    configure,
  }
}

export const provider = configure()
export const model: ProviderPackage.Model<Settings, AnthropicMessages.ProviderOptionsInput> = (
  modelID,
  { apiKey, authToken, baseURL, body, headers, ...providerOptions }: Settings = {},
) => {
  const resolvedBaseURL =
    normalizeBaseURL(baseURL) ??
    normalizeBaseURL(process.env.ANTHROPIC_BASE_URL)
  const resolvedAuthToken = authToken ?? (apiKey === undefined ? process.env.ANTHROPIC_AUTH_TOKEN : undefined)
  if (apiKey !== undefined && authToken !== undefined)
    throw new ProviderConfigurationError({
      provider: id,
      message: "Anthropic apiKey cannot be combined with authToken",
    })
  return configure({
    ...(resolvedAuthToken === undefined ? { apiKey: apiKey } : { auth: Auth.bearer(resolvedAuthToken) }),
    baseURL: resolvedBaseURL,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
  }).model(modelID)
}
