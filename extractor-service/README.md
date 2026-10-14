# Extrator PNCP

Fonte importada da versão implantada, preservando coleta, OCR, pesquisas e
modelos existentes. Build Path no EasyPanel: `/extractor-service`.
Mantenha as variáveis de ambiente e o volume `/data` atuais.

## IA pelo GitHub Copilot

A extração de evidências por partes e as pesquisas usam o mesmo modelo
configurado no serviço Copilot (`COPILOT_MODEL`, padrão `gpt-5.4`).
O extrator não chama mais o OpenRouter.

Configure no **extrator**:

```env
COPILOT_BASE_URL=http://nome-interno-do-servico-copilot:8080
COPILOT_SERVICE_KEY=mesma-chave-privada-configurada-no-servico-copilot
```

Use a origem interna correta, sem caminho, query ou credenciais na URL.
A chave deve ter pelo menos 32 caracteres. As variáveis `OPENROUTER_*`
não são mais utilizadas. Preserve `EXTRACTOR_API_KEY`, o volume e a
configuração de coleta/OCR. Não copie o arquivo de ambiente do frontend:
essas variáveis pertencem ao serviço extrator no EasyPanel.

Publique também a nova versão do serviço Copilot, com `/complete`, e
autentique a conta GitHub com acesso ao Copilot. O modelo é escolhido
exclusivamente nesse serviço, não em cada requisição do extrator.
Não há fallback automático para OpenRouter.

As pesquisas requerem ferramentas web disponíveis no Copilot e URLs
observadas em execuções bem-sucedidas. Fontes oficiais continuam limitadas
a `gov.br`, `comprasnet.gov.br` e `serpro.gov.br`. Sem ferramentas/fontes
verificáveis, a pesquisa registra limitação, não confirmação.
Cada parte gera uma sessão e consome a franquia/limites do Copilot.
O timeout HTTP do extrator é 960 segundos por chamada.

`DELETE /jobs/{job_id}`, autenticado com `X-API-Key`, interrompe a coleta e
pesquisas locais, remove o protocolo SQLite e os documentos/dossiê daquele job.
A operação é idempotente; IDs devem ter 32 caracteres hexadecimais.
Resultados atrasados não recriam protocolos removidos.

O aplicativo usa o coordenador Copilot pelo webhook n8n para também abortar a
sessão de inferência. Chamadas já enviadas a provedores externos não podem ter
seu consumo estornado.

Validação: `python -m unittest discover -p 'test_*.py'`.
