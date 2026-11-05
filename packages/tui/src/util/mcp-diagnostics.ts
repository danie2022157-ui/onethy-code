/**
 * Short, actionable guidance for local MCP failures. The actual transport error
 * remains available via Enter -> full error details.
 */
export function mcpFailureHelp(error: string): string {
  const text = error.toLowerCase()
  if (/enoent|executable not found|command not found|is not recognized|failed to spawn|spawn .*not found/.test(text)) {
    return "Comando local não encontrado. Verifique npx/uvx no PATH e reinicie o OnethyCode após instalar."
  }
  if (/not a git repository|no git repository|not inside a git work tree/.test(text)) {
    return "Abra o OnethyCode dentro de um repositório Git; o MCP Git usa o diretório do projeto."
  }
  if (/no module named|modulenotfounderror|python.*not found/.test(text)) {
    return "Dependência Python ausente; verifique o uvx e a instalação inicial do servidor."
  }
  if (/npm err|404 not found|package.*not found/.test(text)) {
    return "Pacote MCP indisponível; verifique nome do pacote, internet e cache do npm."
  }
  if (/timed? out|timeout|deadline exceeded/.test(text)) {
    return "A inicialização ultrapassou o tempo permitido. Verifique rede, dependências e logs de execução."
  }
  if (/permission denied|eacces|eperm/.test(text)) {
    return "Acesso negado pelo sistema. Verifique permissões do diretório ou do executável."
  }
  return "Falha de inicialização. Pressione Enter para visualizar e copiar o erro completo."
}

export function mcpFailurePreview(error: string): string {
  const reason = mcpFailureHelp(error)
  return reason + "  [Enter: detalhes]"
}
