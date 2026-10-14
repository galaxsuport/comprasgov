# Extrator PNCP

Fonte importada da versão implantada, preservando coleta, OCR, pesquisas e
modelos existentes. Build Path no EasyPanel: `/extractor-service`.
Mantenha as variáveis de ambiente e o volume `/data` atuais.

`DELETE /jobs/{job_id}`, autenticado com `X-API-Key`, interrompe a coleta e
pesquisas locais, remove o protocolo SQLite e os documentos/dossiê daquele job.
A operação é idempotente; IDs devem ter 32 caracteres hexadecimais.
Resultados atrasados não recriam protocolos removidos.

O aplicativo usa o coordenador Copilot pelo webhook n8n para também abortar a
sessão de inferência. Chamadas já enviadas a provedores externos não podem ter
seu consumo estornado.

Validação: `python -m unittest test_cancel.py`.
