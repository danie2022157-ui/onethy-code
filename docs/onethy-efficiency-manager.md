# OnethyCode — Efficiency Manager (2026-11)

O **Efficiency Manager** reaproveita o Code Mode, roteamento Omni, MCPs e compactação existentes. Não abre um modelo de IA extra para tomar cada decisão de economia.

## Perfis

Configure a variável de ambiente **ONETHY_EFFICIENCY_PROFILE** antes de iniciar/reiniciar o processo do OnethyCode:

| Perfil | Roteamento automático | Rodadas por chamada de missão | /goal: rodadas | Subagentes paralelos (padrão) | Saída inline |
| --- | --- | ---: | ---: | ---: | ---: |
| economy | Menor custo de catálogo nas tarefas simples; arquitetura e revisão por contexto | 12 | 18 | 2 | 12 KiB |
| balanced (padrão) | Política existente de qualidade, exploradores por preço | 40 | 50 | 3 | 24 KiB |
| quality | Prioriza modelos recentes e contexto amplo | 40 | 50 | 3 | 50 KiB |

- Um modelo **explicitamente escolhido** pelo usuário ou pelo agente não é substituído por economia.
- O parâmetro maxParallel explicitamente informado em omni_mission prevalece (entre 1 e 8).
- Servidores MCP desativados continuam desativados; permissões e OAuth não mudam.
- Fora do OnethyCode, são usados limites compatíveis com a execução anterior.
- Economy não garante menor custo por tarefa: pode exigir mais tentativas que um modelo mais capaz.

### PowerShell

~~~powershell
$env:ONETHY_EFFICIENCY_PROFILE = "balanced"
onethy
~~~

### Linux / WSL

~~~bash
ONETHY_EFFICIENCY_PROFILE=balanced onethy
~~~

A variável de ambiente precisa estar definida no processo que executa o núcleo. Caso esteja conectado a um serviço persistente, reinicie esse serviço com a configuração desejada.

## Recursos implementados

1. **Custo:** gerações auxiliares publicam eventos de uso; totais incluem títulos, compactação e avaliações de texto quando o provedor fornece os dados.
2. **Tool Search:** Code Mode conserva o catálogo de ferramentas resumido e a busca sob demanda. Mais de 64 namespaces não são listados integralmente no prompt, mas permanecem pesquisáveis.
3. **Memória:** documentos são distribuídos de maneira justa dentro do teto do perfil; o texto omitido continua intacto no disco e acessível via omni_memory.
4. **MCP:** aprendizado de uso local por projeto, com gravações em lote a cada 500ms e descarga na finalização do serviço.
5. **Busca semântica:** Ollama com nomic-embed-text salva vetores em índice local privado por workspace, com invalidação por hash do conteúdo e identidade do modelo. Nenhum código é enviado a serviços remotos por esta rotina.
6. **Agentes:** /goal e missões têm limites por perfil. Se o orçamento acabar, tarefas incompletas nunca são relatadas como concluídas.
7. **Preços:** seleção por custo considera tarifas de entrada, saída, cache de leitura e cache de gravação.

## Diagnóstico de consumo

No chat do OnethyCode, solicite a ferramenta **omni_intelligence**, ação **efficiency**. Ela reporta estatísticas locais dos últimos sete dias: sessões, subagentes, etapas, tokens de entrada, saída, raciocínio e cache e custos estimados/relatados. A ferramenta não chama nenhum modelo por conta própria.

No terminal:

~~~powershell
onethy stats --cost --models --tools
~~~

## Segurança

- Saídas grandes truncadas na conversa são preservadas no armazenamento tool-output para consulta, não descartadas.
- O cache de embeddings não contém texto-fonte, apenas vetores e metadados de arquivos; formato versionado, tamanho limitado, permissões restritas em POSIX.
- O aproveitamento de cache de prompts depende de cada provedor e de configurações compatíveis.
- Uma falha em chamada MCP com possíveis efeitos externos não autoriza repetir uma escrita automaticamente.
- As estatísticas são derivadas dos eventos e preços do catálogo; podem divergir do faturamento de provedores e assinaturas.

## Checklist de validação para produção

~~~bash
bun install --frozen-lockfile
bun --cwd packages/core test test/efficiency-profile.test.ts test/embedding-index.test.ts test/session-generate.test.ts test/session-stats.test.ts test/codemode/catalog.test.ts test/mcp-usage.test.ts
bun --cwd packages/core run typecheck:tsc
bun --cwd packages/cli run typecheck:tsc
~~~

Após os testes locais de CI, realizar validação com contas reais:

1. Executar os mesmos casos de leitura, correção de bugs, refatoração, missões e agentes nos perfis balanced e economy.
2. Medir **custo total por tarefa verificada**, tokens, cache, latência, sucesso e tentativas.
3. Testar MCP próprio, autenticação vencida, servidor em standby e servidor desabilitado.
4. Reiniciar o aplicativo e confirmar persistência de aprendizado e embeddings.
5. Verificar isolamento de workspace e permissões no Windows PowerShell e WSL.
6. Comparar pelo menos dois provedores reais, especialmente quando o suporte a cache é diferente.
7. Só liberar gradualmente em produção depois de observar os resultados e manter um rollback.

A meta de -20% no custo por tarefa correta é **hipótese de benchmark**, não uma economia já comprovada.

## Limitações importantes

O roteamento usa tarifas de catálogo e categorias de trabalho, não um modelo de qualidade treinado com benchmarks do usuário. Algumas tentativas com erro não trazem dados de uso do provedor e podem não aparecer no custo. O Memory Bank é recortado por limites com consulta sob demanda; ainda não existe um mecanismo de seleção semântica de todos os históricos. Esquemas MCP remotos não são persistidos para pular autenticação/handshake porque isso exigiria um mecanismo adicional seguro de invalidação e autorização.

Essas áreas exigem avaliação com provedores reais antes de afirmar que todas as integrações estão preparadas para produção.
