# Contratações TIC

Este projeto exibe os resultados do endpoint n8n diretamente em uma interface moderna.

## Instalação

```bash
cd frontend
npm install
cd ../server
npm install
```

## Executar localmente

Configure `frontend/.env` com as credenciais do usuário e o endpoint de consulta:

```env
AUTH_USERNAME=seu-usuario
AUTH_PASSWORD=sua-senha
VITE_API_BASE_URL=https://seu-webhook-do-ambiente
```

O arquivo `.env` é ignorado pelo Git. Inicie a aplicação pela pasta `frontend`; o comando inicia a API e a interface:

```bash
cd ../frontend
npm run dev
```

## Configurar endpoint

Para homologação local, configure `VITE_API_BASE_URL` em `.env.homolog.local`. No EasyPanel, configure `VITE_API_BASE_URL`, `AUTH_USERNAME` e `AUTH_PASSWORD` como variáveis do serviço.

O container agora executa a API e serve a interface. Monte um volume persistente no caminho `/data` para que o banco SQLite de favoritos sobreviva a reinícios e atualizações.

No desenvolvimento, o banco fica em `server/data/comprasgov.sqlite`. O login é validado no servidor e a sessão usa um cookie `HttpOnly`. Os favoritos ficam associados à conta autenticada e são compartilhados entre dispositivos. `AUTH_PASSWORD` deve ser configurada apenas no `.env` local ignorado pelo Git ou no ambiente do servidor; não use o prefixo `VITE_` para credenciais.

A senha pode ser alterada em Configurações. A nova senha é guardada com hash no SQLite (não no `.env`) e passa a prevalecer sobre `AUTH_PASSWORD`; as demais sessões são encerradas. Para voltar à senha do ambiente, apague a linha correspondente da tabela `credentials`.

Em cada consulta a `/api/pregoes`, o servidor anexa ao webhook as configurações da conta autenticada: `prazo` (dias, 1 a 15; padrão `DEADLINE_DEFAULT_DAYS`) e `termosFortes`, `termosContextuais`, `contextosTecnologicos` e `termosExclusao` (listas separadas por vírgula). Esses valores prevalecem sobre os enviados pelo navegador.

### Análise de editais

O botão **Analisar** do card envia `{ "UASG", "numeroCompra" }` por POST ao endpoint `ANALYSIS_WEBHOOK_URL`, com o cabeçalho `X-Workflow-Key` definido por `ANALYSIS_WORKFLOW_KEY` (a chave fica só no servidor). O `job_id` e os dados do card são gravados no banco; a tela de análises consulta o endpoint `consultar` a cada 5 s para atualizar `status` e `mensagem` e, ao concluir, guarda o HTML de `relatorioHtml`, aberto em `/api/analysis/<job_id>/report` dentro de um sandbox sem scripts.
