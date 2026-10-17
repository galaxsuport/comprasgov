# Extrator PNCP

Serviço para coleta de dados públicos do PNCP, download de documentos e
extração de texto por OCR. Build Path no EasyPanel: `/extractor-service`.
Mantenha as variáveis de ambiente e o volume `/data` atuais.

O extrator prepara um dossiê com os dados da contratação, metadados dos
documentos e textos extraídos. A coleta automática não gera resumos nem
executa pesquisas web; o agente pode consultar os textos por documento.

## Pesquisa web do agente

Configure `OPENROUTER_API_KEY` no ambiente do serviço extrator. Opcionalmente,
defina `OPENROUTER_MODEL`; o padrão é `openrouter/auto`, com o plugin web do
OpenRouter. O uso da pesquisa web pode gerar custos no provedor.

`POST /jobs/{job_id}/pesquisar`, autenticado com `X-API-Key`, recebe:

```json
{
  "consulta": "Confirme a retificação e a data da sessão desta contratação",
  "escopo": "oficial"
}
```

`escopo` aceita `oficial` ou `fabricante`. Pesquisas oficiais restringem o
plugin aos domínios `gov.br`, `comprasnet.gov.br` e `serpro.gov.br`, e a API
filtra citações para esses domínios. Pesquisas de fabricante retornam citações
HTTPS encontradas pelo provedor; o agente deve avaliar se são documentação
primária do fabricante/mantenedor. Respostas sem citações verificáveis são
rejeitadas. O resultado contém `resposta`, `fontes`, `consulta`, `escopo`,
`consultado_em` e `modelo`, e é armazenado no job.

HTTP 429 do OpenRouter retorna 503 para indicar indisponibilidade temporária;
timeout retorna 504. Cada chamada tem limite de 180 segundos.

`DELETE /jobs/{job_id}`, autenticado com `X-API-Key`, interrompe a coleta,
remove o protocolo SQLite e os documentos daquele job. A operação é
idempotente; IDs devem ter 32 caracteres hexadecimais.

Validação: `python -m unittest discover -p 'test_*.py'`.
