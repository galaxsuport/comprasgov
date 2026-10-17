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
