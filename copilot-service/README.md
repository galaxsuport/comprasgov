# Agente PNCP com GitHub Copilot

Serviço HTTP independente com o SDK oficial do Copilot e modelo `gpt-5.4`.
O extrator continua responsável pela coleta e pela validação das pesquisas,
mas toda inferência passa pelo Copilot, sem OpenRouter. No relatório final,
o modelo recebe três ferramentas: leitura do documento original, pesquisa
oficial e pesquisa de fabricantes. Shell, arquivos locais e MCP não são
permitidos. Sessões de resumo não recebem ferramentas; sessões de pesquisa
recebem apenas `web_search` e `web_fetch`.

## EasyPanel

- Fonte: repositório `galaxsuport/comprasgov`, branch `master`.
- Build Path: `/copilot-service`; build por `Dockerfile`.
- Porta interna: `8080`.
- Volume persistente: `/home/node/.copilot`, gravável por UID 1000.

Variáveis obrigatórias:

```env
COPILOT_MODEL=gpt-5.4
COPILOT_SERVICE_KEY=segredo-aleatorio-com-pelo-menos-32-caracteres
EXTRACTOR_BASE_URL=http://galaxsuport_pncp-extractor:8080
EXTRACTOR_API_KEY=chave-privada-do-extrator
```

Confirme o endereço interno do extrator antes de usar o exemplo.
Não publique chaves nem credenciais no repositório.
Nesta implantação, a conexão interna reutiliza a credencial `X-API-Key` do
extrator, conforme autorizado: `COPILOT_SERVICE_KEY` e `EXTRACTOR_API_KEY` têm
o mesmo valor, sem alterar a credencial existente no n8n. O login GitHub é
independente dessa chave.

No console, como usuário `node`, autentique:

```sh
HOME=/home/node /app/node_modules/.bin/copilot login --device-code
```

Complete a autorização no GitHub e reinicie o serviço. Em contêineres sem
chaveiro do sistema, o CLI armazena a credencial no volume; proteja o diretório
e seus backups. Como alternativa, configure `COPILOT_GITHUB_TOKEN` com um token
fine-grained com **Copilot Requests**.

## Integração n8n

`GET /health`, com header `X-API-Key`, retorna 200 se autenticado e 503 se
aguardando autenticação.

`POST /analyze` usa o mesmo header e aceita:

```json
{
  "job_id": "id-do-job-no-extrator",
  "prompt": "Mesmo prompt do agente atual, incluindo o dossiê completo",
  "systemMessage": "Mesma mensagem de sistema do agente atual"
}
```

Retorno: `{ "job_id": "...", "model": "gpt-5.4", "output": "relatório" }`.
Configure timeout HTTP de 960000 ms; o timeout do SDK é 900000 ms.
Uma análise por vez é permitida; concorrência retorna 429.
Uma chamada de extração/pesquisa também pode executar em paralelo ao relatório,
pois as ferramentas do relatório consultam o extrator, que retorna ao Copilot.
Antes de iniciar uma sessão, o protocolo precisa existir no extrator.
`POST /jobs/{job_id}/cancel`, com a mesma chave, remove os dados do extrator,
interrompe as ferramentas e aborta/desconecta a sessão ativa antes de confirmar
`{ "job_id": "...", "cancelled": true }`. Chamadas atrasadas não iniciam inferência
para protocolos removidos. Requer o endpoint DELETE da versão atual do extrator.
O cancelamento interrompe todas as sessões daquele protocolo, inclusive
resumos e pesquisas. A desconexão do cliente também interrompe sua sessão.
Falhas e respostas vazias retornam HTTP 502, não relatórios de sucesso.
Preserve a gravação de falhas pelo fluxo e não publique a substituição do agente
antes de verificar uma análise real.

Cada solicitação cria uma sessão independente e consome a franquia da conta
Copilot autenticada. A assinatura não implica uso ilimitado.

## Integração do extrator

Configure `COPILOT_BASE_URL` e `COPILOT_SERVICE_KEY` no extrator e publique
as duas versões juntas. O endpoint autenticado `POST /complete` aceita
`job_id`, `prompt`, `systemMessage` e `purpose` (`summary` ou `research`).
Pesquisas também exigem `scope` (`oficial` ou `fabricante`).
O modelo permanece o `COPILOT_MODEL` deste serviço.

O retorno contém `job_id`, `model` e `output`; para pesquisa inclui
`evidence_urls`, URLs abertas com sucesso por `web_fetch` ou retornadas
por `web_search`. A pesquisa oficial só aceita os domínios
`gov.br`, `comprasnet.gov.br` e `serpro.gov.br`. O extrator cruza as
citações com essas URLs e rejeita respostas sem fontes verificáveis.
Ferramentas web precisam estar disponíveis na conta/modelo: sua ausência
retorna falha explícita, nunca pesquisa presumida.

Uma chamada `/complete` por vez é permitida (HTTP 429 se ocupado).
O slot é liberado após desconectar a sessão, antes de responder.
Mantenha timeout HTTP de 960000 ms também no extrator e nos proxies internos.

## Testes

```sh
npm ci
npm test
```
