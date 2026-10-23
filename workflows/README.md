# Fluxo n8n do PNCP

`PNCP - extractor.json` é um export corrigido do fluxo recebido. O anexo
original não foi alterado.

## Alterações

- As consultas ao PNCP agora são sequenciais, com intervalo mínimo de 1 segundo.
- Erros transitórios, incluindo HTTP 429, são repetidos até três vezes além da
  tentativa inicial. O fluxo respeita `Retry-After` quando o PNCP o informa.
- Se o limite 429 persistir, novas consultas ao PNCP são interrompidas. O fluxo
  retorna HTTP 503 com uma mensagem e diagnóstico, em vez de tentar seguir com
  uma busca incompleta como se fosse uma ausência definitiva.
- Falhas por tempo esgotado retornam HTTP 504; compra não localizada retorna
  404; entrada inválida continua retornando 400.
- O webhook `pncp-analise` recebe `idContratacaoPNCP` (Id contratação PNCP) e
  deriva diretamente a URL da contratação. Isso elimina a busca por UASG,
  número da compra e períodos antes de iniciar a análise.
- Os títulos das 18 seções do relatório são gerados como cabeçalhos Markdown e
  entram no índice lateral do HTML. O renderer também reconhece esses títulos
  quando chegam como linhas numeradas simples, evitando um índice vazio.
- A pesquisa exata por UASG e número/ano consulta diretamente a API de
  publicações do PNCP, sem depender da sincronização dos Dados Abertos. Primeiro
  consulta Dispensas dos últimos 30 dias do ano informado e só consulta as
  modalidades de pregão se não encontrar a compra. Se ainda não houver
  resultado, amplia a busca para o ano completo. As consultas limitam os
  resultados à UASG e usam lotes espaçados. Se a API indicar páginas adicionais
  não consultadas, o fluxo sinaliza que o resultado pode estar incompleto.
- A saída da pesquisa preserva o nome/código do tipo de instrumento convocatório
  e o ano da compra, para exibir, por exemplo, "Aviso de Contratação Direta nº
  400/2026" nos cards. Importe o export de pesquisa atualizado no n8n e refaça
  a pesquisa para receber esses campos; resultados antigos não são alterados.
- As ferramentas `pesquisar_fontes_oficiais` e `pesquisar_fabricantes` estão
  mantidas e conectadas ao agente. O extrator implementa
  `POST /jobs/{job_id}/pesquisar`; configure `OPENROUTER_API_KEY` no ambiente
  do serviço extrator para habilitar a busca web. O `X-API-Key` existente
  autentica as chamadas.
- O cancelamento usa `DELETE /jobs/{job_id}`, rota oferecida pelo extrator atual.

## Importação

Importe o JSON no n8n e confira as credenciais de `X-Workflow-Key`,
`X-API-Key` e OpenRouter antes de ativar o fluxo. IDs de credenciais do export
podem não corresponder aos IDs da instância de destino.
