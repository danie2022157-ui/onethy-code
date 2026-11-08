/**
 * Built-in plugins use OnethyCode's own runtime hooks.
 * Descriptors do not load arbitrary JavaScript or external packages.
 * Enabling a plugin requires an explicit user configuration choice.
 */
export function curatedNativePlugins() {
  return [
    {
      file: "local-sensitive-file-guard.json",
      id: "onethy-local-sensitive-file-guard",
      name: "Proteção de arquivos sensíveis",
      kind: "plugin",
      implementation: "local-sensitive-file-guard",
      enabled: false,
      description: "Protege arquivos de credenciais em operações de leitura e escrita."
    },
    {
      file: "local-tool-preference.json",
      id: "onethy-local-tool-preference",
      name: "Preferência por ferramentas locais",
      kind: "plugin",
      implementation: "local-tool-preference",
      enabled: false,
      description: "Orienta agentes a priorizar ferramentas locais e verificar permissões."
    },
  ]
}
