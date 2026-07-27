---
name: analisar-workflow-n8n
description: Analisa um workflow n8n existente (por nome ou id) e produz uma avaliação estruturada da qualidade do desenho — tratamento de erros, pontos únicos de falha, segurança, nós órfãos, execuções reais recentes — não só um inventário de nós.
---

Objectivo: dado um workflow n8n (nome ou id), avaliar se está bem desenhado e devolver
um relatório estruturado e accionável — não uma simples lista de nós.

## Passo 1 — Localizar e ler o workflow

1. Se só tiveres um nome (não um id), chama `mcp__n8n__list_workflows` com `name` para
   encontrar o id. Se houver mais do que um resultado, pede ao utilizador para confirmar
   qual.
2. Chama `mcp__n8n__get_workflow` com o id para obter nós, parâmetros (já sanitizados),
   credenciais usadas (nome/tipo, nunca o segredo) e ligações entre nós.
3. Chama `mcp__n8n__list_executions` filtrado a este `workflow_id` (limit ~20) para ver o
   histórico real recente. Se houver execuções com `status=error`, chama
   `mcp__n8n__get_execution` numa ou duas das mais recentes para veres qual nó falhou e
   porquê — problemas reais e já acontecidos pesam mais no relatório do que problemas só
   teóricos.

Isto é só leitura — nunca uses `mcp__n8n__set_workflow_active` como parte desta análise
(só se o utilizador pedir explicitamente para activar/desactivar depois de veres o
relatório).

## Passo 2 — Avaliar contra esta checklist

Para cada ponto, só reportar se for de facto observável nos dados lidos — não inventes
problemas hipotéticos que os dados não sustentam.

**Fiabilidade / tratamento de erros**
- Existe algum "Error Workflow" configurado para este workflow, ou nós críticos têm
  `Continue On Fail` / `Retry On Fail` ligado onde faz sentido (chamadas HTTP, APIs
  externas)? Falta disto num nó que fala com um serviço externo é um risco real.
- Nós que fazem loop sobre listas (Split In Batches, Loop Over Items) a chamar uma API
  externa sem controlo de ritmo — risco de rate-limit.

**Pontos únicos de falha e estrutura**
- Nós **órfãos**: aparecem em `Nós` mas não aparecem nem como origem nem como destino em
  `Ligações` — nunca são executados, ou ficaram esquecidos de uma versão antiga.
- Ramos de IF/Switch sem ligação de saída (um caminho possível que não vai a lado nenhum) —
  normalmente um bug silencioso.
- Lógica duplicada em vários pontos do mesmo workflow que podia ser um sub-workflow
  reutilizável.

**Segurança**
- Triggers do tipo Webhook sem autenticação configurada (verificar parâmetros do nó
  trigger) — endpoint público sem protecção.
- Parâmetros com valores que parecem segredos escritos directamente (não via credencial) —
  quando aconteces, já vêm redactados no `get_workflow`, mas a presença de um campo como
  "apiKey"/"token"/"password" com um parâmetro literal (não uma referência de credencial) é
  em si um sinal a reportar, mesmo sem veres o valor.

**Clareza**
- Nomes de nós genéricos por omissão (ex: "HTTP Request1", "IF2") em vez de nomes
  descritivos — dificulta manutenção futura por outra pessoa.
- Workflow inactivo (`Estado: inactive`) — confirmar com o utilizador se é intencional
  (workflow em desenvolvimento) ou esquecido.

## Passo 3 — Formato da resposta

Estrutura sempre a resposta assim (em português, directa, sem inflar problemas menores):

1. **Resumo** — 1-2 frases: o que o workflow faz e se está activo.
2. **Estado real** — o que as execuções recentes mostram (tudo a correr bem / X falhas
   recentes e em que nó / sem histórico ainda).
3. **Problemas encontrados** — lista, cada um com severidade (crítico/médio/cosmético) e o
   nó exacto onde ocorre. Se não encontrares nada de relevante, di-lo claramente em vez de
   inventar um ponto fraco só para preencher a secção.
4. **Sugestões concretas** — o que mudar, nó a nó, não conselhos genéricos.
5. Se faltar contexto para avaliar algo com confiança (ex: não é claro qual é o
   comportamento esperado de um ramo), pergunta em vez de assumir.
