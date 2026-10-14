# Contratações TIC

Este projeto exibe os resultados do endpoint n8n diretamente em uma interface moderna.

A situação do edital aparece nos badges do cabeçalho de cada card, junto da modalidade, SRP e modo de disputa.

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

O container agora executa a API e serve a interface. Monte um volume persistente no caminho `/data` para que as configurações, propostas agendadas e propostas descartadas do banco SQLite sobrevivam a reinícios e atualizações.

No desenvolvimento, o banco fica em `server/data/comprasgov.sqlite`. O login é validado no servidor e a sessão usa um cookie `HttpOnly`. `AUTH_PASSWORD` deve ser configurada apenas no `.env` local ignorado pelo Git ou no ambiente do servidor; não use o prefixo `VITE_` para credenciais.

A senha pode ser alterada em Configurações. A nova senha é guardada com hash no SQLite (não no `.env`) e passa a prevalecer sobre `AUTH_PASSWORD`; as demais sessões são encerradas. Para voltar à senha do ambiente, apague a linha correspondente da tabela `credentials`.

Em cada consulta a `/api/pregoes`, o servidor anexa ao webhook as configurações da conta autenticada: `prazo` (dias, 1 a 15; padrão `DEADLINE_DEFAULT_DAYS`) e `termosFortes`, `termosContextuais`, `contextosTecnologicos` e `termosExclusao` (listas separadas por vírgula). Esses valores prevalecem sobre os enviados pelo navegador.

### Homologação sem login

Com `APP_ENV=homologacao` no ambiente do servidor, o app dispensa a tela de login e o botão Sair, e usa a conta `AUTH_USERNAME` (ou `homologacao`) para guardar propostas descartadas e propostas agendadas. `AUTH_USERNAME` e `AUTH_PASSWORD` deixam de ser obrigatórios. **Nunca defina essa variável em produção**: qualquer pessoa com acesso à URL passa a usar o app.

### Análise no card do edital

O botão **Analisar**, com lupa, inicia imediatamente o fluxo n8n/Copilot e fica desabilitado como **Analisando**. Configure `ANALYSIS_WEBHOOK_URL` e `ANALYSIS_WORKFLOW_KEY` somente no ambiente privado da API. O servidor envia `{ "UASG", "numeroCompra" }` com o cabeçalho `X-Workflow-Key`.

A tabela `analysis_jobs` guarda os jobs e relatórios por conta, permitindo retomar o acompanhamento após recarregar a página. Os cards exibem job_id, tempo, status e mensagem; o acompanhamento consulta o serviço a cada 2 segundos. `pronto_para_agente` permanece intermediário. Falhas de comunicação são exibidas e não são tratadas como conclusão.

Ao terminar, o card oferece **Refazer análise** e, quando disponível, **Resultado**. A nova análise substitui o registro e relatório anteriores depois que o serviço confirma o início; se a chamada falhar, o resultado anterior é preservado. O HTML externo é servido com sandbox sem scripts. Não há lista de análises nem card de análises no painel de controle. Dados excluídos pela remoção anterior não são recuperados.
