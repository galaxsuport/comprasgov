# Contratações TIC

Este projeto exibe os resultados do endpoint n8n diretamente em uma interface moderna.

A situação do edital aparece nos badges do cabeçalho de cada card, junto da modalidade, SRP e modo de disputa.

Ao descartar uma proposta, todas as ações do card ficam desabilitadas, incluindo análise/cancelamento, resultado, calendário e links. Somente **Desfazer descartar** permanece disponível. Descartar não cancela automaticamente uma análise em andamento.

Propostas agendadas exigem confirmação **Sim/Não** antes do descarte, avisando que o agendamento também será removido. **Não** ou Escape preservam ambos os registros; **Sim** descarta e remove o agendamento em uma única transação. Desfazer o descarte não restaura o agendamento.

O calendário de propostas agendadas mostra somente propostas com data igual ou posterior ao dia atual, no horário local do navegador (incluindo horários já passados de hoje). A grade, os totais e a lista seguem esse filtro. A data considerada continua sendo o encerramento da proposta, com abertura e publicação como alternativas. Propostas antigas ou sem data válida permanecem salvas, mas não aparecem no calendário.

O botão **Visualizar edital** nos cards do calendário abre a proposta salva no card principal, com suas ações e análise, mesmo sem resultados de pesquisa carregados. A pesquisa anterior é preservada e pode ser retomada por **Voltar aos resultados da pesquisa**.

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

Na execução local padrão, a API lê `VITE_API_BASE_URL` de `frontend/.env`; arquivos de modo do Vite, como `.env.homolog.local`, não alteram o ambiente da API. No EasyPanel, configure `VITE_API_BASE_URL`, `AUTH_USERNAME` e `AUTH_PASSWORD` como variáveis do serviço.

O container agora executa a API e serve a interface. Monte um volume persistente no caminho `/data` para que as configurações, propostas agendadas e propostas descartadas do banco SQLite sobrevivam a reinícios e atualizações.

No desenvolvimento, o banco fica em `server/data/comprasgov.sqlite`. O login é validado no servidor e a sessão usa um cookie `HttpOnly`. `AUTH_PASSWORD` deve ser configurada apenas no `.env` local ignorado pelo Git ou no ambiente do servidor; não use o prefixo `VITE_` para credenciais.

A senha pode ser alterada em Configurações. A nova senha é guardada com hash no SQLite (não no `.env`) e passa a prevalecer sobre `AUTH_PASSWORD`; as demais sessões são encerradas. Para voltar à senha do ambiente, apague a linha correspondente da tabela `credentials`.

Em cada consulta a `/api/pregoes`, o servidor anexa ao webhook as configurações da conta autenticada: `prazo` (dias, 1 a 15; padrão `DEADLINE_DEFAULT_DAYS`) e `termosFortes`, `termosContextuais`, `contextosTecnologicos` e `termosExclusao` (listas separadas por vírgula). Esses valores prevalecem sobre os enviados pelo navegador.

### Homologação sem login

Com `APP_ENV=homologacao` no ambiente do servidor, o app dispensa a tela de login e o botão Sair, e usa a conta `AUTH_USERNAME` (ou `homologacao`) para guardar propostas descartadas e propostas agendadas. `AUTH_USERNAME` e `AUTH_PASSWORD` deixam de ser obrigatórios. **Nunca defina essa variável em produção**: qualquer pessoa com acesso à URL passa a usar o app.

### Análise no card do edital

O botão **Analisar**, com lupa, inicia imediatamente o fluxo n8n/Copilot e passa a oferecer **Cancelar análise**, inclusive enquanto o protocolo está sendo criado. Durante o cancelamento, fica desabilitado como **Cancelando...**. Configure `ANALYSIS_WEBHOOK_URL` e `ANALYSIS_WORKFLOW_KEY` somente no ambiente privado da API. O servidor envia `{ "UASG", "numeroCompra" }` com o cabeçalho `X-Workflow-Key`.

O webhook irmão `pncp-cancelar` recebe `{ "job_id" }` com a mesma autenticação e aciona `POST /jobs/{job_id}/cancel` do serviço Copilot. Esse coordenador remove os dados do extrator e aborta a sessão SDK; o fluxo n8n deixa de continuar quando o protocolo é removido. Somente após confirmação externa a API exclui todos os jobs/relatórios da proposta e o card volta a **Analisar**. Se o cancelamento falhar, os registros locais permanecem e o erro é exibido. Consumo já realizado em provedores externos não é estornado.

A tabela `analysis_jobs` guarda os jobs e relatórios por conta, permitindo retomar o acompanhamento após recarregar a página. Os cards exibem job_id, status e mensagem de progresso limitada a 255 caracteres na interface, API e banco. Mensagens antigas maiores são truncadas na inicialização da API. O tempo de análise aparece somente ao finalizar, com duração fixa; o acompanhamento consulta o serviço a cada 2 segundos. `pronto_para_agente` permanece intermediário. Falhas de comunicação são exibidas e não são tratadas como conclusão.

Na inicialização, a API remove somente placeholders do fluxo antigo: status
`pendente`, ID `pendente-*`, endereços de consulta/relatório vazios e nenhum
relatório salvo. Eles nunca receberam protocolo externo e não devem gerar
polling. Jobs reais e relatórios existentes são preservados.

Ao terminar, o card oferece **Refazer análise** e, quando disponível, **Resultado**. A nova análise substitui o registro e relatório anteriores depois que o serviço confirma o início; se a chamada falhar, o resultado anterior é preservado. O HTML externo é servido com sandbox sem scripts. Não há lista de análises nem card de análises no painel de controle. Dados excluídos pela remoção anterior não são recuperados.

### Diagnóstico de comunicação

HTTP 502 indica falha entre a API/proxy e um serviço externo, não necessariamente falha do edital. A interface preserva as mensagens JSON de erro do servidor/n8n e identifica respostas HTML de gateway. Erros de conexão incluem o código de rede; timeouts da API retornam HTTP 504.

O início de análise aguarda até 90 segundos; consultas de status/relatório, 30 segundos. A pesquisa usa limite de 145 segundos na API e 150 segundos no navegador. Não há repetição automática de POST de análise: em caso de timeout, verifique a execução no n8n antes de reenviar, para evitar jobs duplicados e consumo adicional do Copilot. Um erro `Task execution timed out after 60 seconds` em um nó Code deve ser investigado no executor de tarefas do n8n; aumentar o timeout da interface não corrige esse executor.

O Dockerfile da raiz usa Node para servir a API e a interface; configurações Nginx antigas não fazem parte dessa implantação. Todas as cinco tabelas atuais são usadas: `credentials`, `settings`, `discarded_proposals`, `registered_proposals` e `analysis_jobs`. Contas diferentes e jobs sem proposta agendada não são, por si só, registros órfãos.

### Validação

Execute `npm test` nas pastas `frontend`, `server` e `copilot-service`, e `npm run build` em `frontend`. Os testes usam serviços simulados e não consomem a franquia Copilot.
