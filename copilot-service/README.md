# Agente PNCP com GitHub Copilot

Serviço HTTP independente com o SDK oficial do Copilot e modelo `gpt-5.4`.
O extrator existente continua responsável pela coleta e pelas pesquisas.
O modelo recebe somente três ferramentas: leitura do documento original,
pesquisa oficial e pesquisa de fabricantes. Shell, arquivos e MCP não são
permitidos.

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
Falhas e respostas vazias retornam HTTP 502, não relatórios de sucesso.
Preserve a gravação de falhas pelo fluxo e não publique a substituição do agente
antes de verificar uma análise real.

Cada solicitação cria uma sessão independente e consome a franquia da conta
Copilot autenticada. A assinatura não implica uso ilimitado.

## Testes

```sh
npm ci
npm test
```
