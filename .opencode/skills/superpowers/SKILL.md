---
name: superpowers
description: Ativa a metodologia Superpowers (obra/superpowers) nativamente no OnethyCode: brainstorming, writing-plans, subagent-driven-development, TDD, code review e finishing-a-development-branch como fluxos obrigatórios antes de qualquer tarefa de construção.
opencode/autoinvoke: true
disable-model-invocation: false
---

# Superpowers (obra/superpowers) — nativo no OnethyCode

Superpowers é uma metodologia de desenvolvimento de software baseada em skills compostáveis e instruções iniciais que fazem o agente parar, definir o escopo, planejar e revisar antes de escrever código.

## Quando usar

Use sempre que o usuário pedir para construir, refatorar, corrigir ou projetar algo no OnethyCode. Não pule direto para a escrita de código.

## Fluxo obrigatório (não são sugestões)

1. **brainstorming** — antes de construir, pergunte ao usuário o que ele realmente quer fazer e por quê. Desenhe o entendimento de volta ao usuário para correção. Mudanças pequenas acertam no chat; projetos recebem um documento de design escrito.
2. **writing-plans** — com o design aprovado, quebre o trabalho em tarefas pequenas (2–5 minutos cada). Cada tarefa deve conter caminhos de arquivo exatos, código completo e etapas de verificação.
3. **subagent-driven-development** — com o plano aprovado, execute cada tarefa com subagentes isolados (worktrees), com revisão após cada tarefa.
4. **test-driven-development** — durante a implementação, escreva um teste que falhe primeiro, depois o código mínimo para passar, refatore e comite. Não escreva código antes de testes.
5. **requesting-code-review** — entre tarefas, revise o plano e reporte problemas por severidade. Problemas críticos bloqueiam o progresso.
6. **finishing-a-development-branch** — quando as tarefas terminarem, verifique os testes, apresente opções (merge/PR/manter/descartar) e limpe os worktrees.

## Regras de condição

- Se a tarefa for pequena e já estiver definida, pode ir direto para a implementação; use brainstorming e writing-plans apenas quando houver ambiguidade ou necessidade de design.
- Não use `any` tipo; evite `try/catch` quando possível.
- Antes de adicionar complexidade para casos de borda teóricos, explique o modo de falha concreto, probabilidade e custo ao usuário e obtenha aprovação.

## Como carregar

Esta skill está registrada no `opencode.jsonc` e carregada pelo `ConfigSkillPlugin` do OnethyCode. Não executa scripts externos nem faz instalação de pacotes.

Referência upstream: https://github.com/obra/superpowers
