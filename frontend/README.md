# Contratações TIC

Este projeto exibe os resultados do endpoint n8n diretamente em uma interface moderna.

A situação do edital aparece nos badges do cabeçalho de cada card, junto da modalidade, SRP e modo de disputa.
Quando a situação é **Suspensa**, seu badge usa o mesmo destaque vermelho do SRP,
tanto para dados salvos quanto após a atualização ao abrir o card.

Ao abrir um card de oportunidade, a situação é consultada na API oficial do
PNCP por meio do servidor e substitui a situação da última pesquisa. O tipo
do instrumento convocatório e o número/ano oficiais da compra também são
consultados e exibidos no cabeçalho do card.
Não há polling nem atualização periódica da situação: a consulta ocorre
na montagem do card ou quando sua identificação PNCP muda. Aplica-se também
a cards abertos a partir de propostas salvas. O servidor atualiza a situação
e os dados oficiais do instrumento nas propostas salvas agendadas/descartadas
da mesma conta, preservando os demais dados.
Enquanto consulta, o badge informa **Atualizando situação...**; em falhas ou
identificação ausente, mantém a última situação e exibe **Situação não atualizada**
com o detalhe no tooltip. Nunca presume uma situação nova sem resposta válida.
As chamadas ao PNCP são serializadas entre os cards e o cron, com intervalo
mínimo de um segundo. Ao receber HTTP 429, o servidor respeita `Retry-After`
e pausa novas consultas durante o limite informado; os dados já exibidos são
preservados.

### Cron de situação das propostas agendadas

A API executa `0 * * * *` em `America/Sao_Paulo`: no início de cada hora,
consulta o PNCP e atualiza `situacao` no JSON de **todas** as propostas
agendadas (`registered_proposals`), em todas as contas, incluindo datas
passadas. O cron não depende de navegador aberto. Propostas iguais em
contas diferentes compartilham uma consulta; chamadas usam a fila serializada
compartilhada com a interface, com intervalo mínimo de 1 segundo e timeout de
30 segundos. Se o PNCP retornar HTTP 429, o cron pausa o ciclo e preserva os
dados ainda não atualizados.

Falhas ou identificadores inválidos são registrados nos logs e preservam
a última situação, sem impedir a atualização das demais propostas.
Os logs também informam os totais atualizados e as falhas.
O cron não altera datas, agendamentos, descartadas ou análises e não recria
propostas removidas durante a consulta. Não permite execuções sobrepostas.
No desligamento, interrompe as consultas antes de fechar o banco.

O cron roda no processo da API; requer que o serviço permaneça ativo e
uma única instância use esse volume SQLite. Após publicar a nova imagem,
não é preciso configurar um cron externo no EasyPanel. A próxima execução
ocorre na hora cheia, sem execução imediata na inicialização.

Ao descartar uma proposta, todas as ações do card ficam desabilitadas, incluindo análise/cancelamento, resultado, calendário e links. Somente **Desfazer descartar** permanece disponível. Descartar não cancela automaticamente uma análise em andamento.

Propostas agendadas exigem confirmação **Sim/Não** antes do descarte, avisando que o agendamento também será removido. **Não** ou Escape preservam ambos os registros; **Sim** descarta e remove o agendamento em uma única transação. Desfazer o descarte não restaura o agendamento.

Propostas descartadas com data anterior a hoje são excluídas permanentemente
do banco na inicialização da API e ao consultar/atualizar descartadas.
A data considerada é o encerramento da proposta, com abertura e publicação
como alternativas, no fuso `America/Sao_Paulo`. Datas sem fuso são interpretadas
nesse horário. Propostas de hoje (mesmo com horário já passado), futuras e sem
data válida são preservadas. O horário do descarte não interfere na limpeza.
A tela sincroniza a lista a cada minuto, ao voltar para a janela, ao abrir/fechar
descartadas e após descartar/restaurar, atualizando também os totais do painel.
Essa limpeza não remove agendamentos nem análises.

O calendário de propostas agendadas mostra somente propostas com data igual ou posterior ao dia atual, no horário local do navegador (incluindo horários já passados de hoje). A grade, os totais, a lista e o contador de propostas agendadas do painel seguem esse mesmo filtro. A data considerada é o encerramento da proposta, com abertura e publicação como alternativas quando a data anterior estiver ausente ou inválida. Propostas antigas ou sem data válida permanecem salvas, mas não aparecem no calendário nem no contador.

As propostas no calendário e na lista de agendamentos usam o mesmo card de resultado da pesquisa, com os dados e ações disponíveis para a proposta.

Os cards do calendário também permitem iniciar ou cancelar análises, consultar relatórios e usar as demais ações do card de pesquisa.

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

O botão **Analisar**, com lupa, inicia imediatamente o fluxo n8n e passa a oferecer **Cancelar análise**, inclusive enquanto o protocolo está sendo criado. Durante o cancelamento, fica desabilitado como **Cancelando...**. Configure `ANALYSIS_WEBHOOK_URL` e `ANALYSIS_WORKFLOW_KEY` somente no ambiente privado da API. O servidor envia `{ "UASG", "numeroCompra" }` com o cabeçalho `X-Workflow-Key`.

O webhook irmão `pncp-cancelar` recebe `{ "job_id" }` com a mesma autenticação e cancela o processamento externo e o job do extrator. Somente após confirmação externa a API exclui todos os jobs/relatórios da proposta e o card volta a **Analisar**. Se o cancelamento falhar, os registros locais permanecem e o erro é exibido.

A tabela `analysis_jobs` guarda os jobs e relatórios por conta, permitindo retomar o acompanhamento após recarregar a página. Os cards exibem job_id, status e mensagem de progresso limitada a 255 caracteres na interface, API e banco. Mensagens antigas maiores são truncadas na inicialização da API. O tempo de análise aparece somente ao finalizar, com duração fixa; o acompanhamento consulta o serviço a cada 2 segundos. `pronto_para_agente` permanece intermediário. Falhas de comunicação são exibidas e não são tratadas como conclusão.

Na inicialização, a API remove somente placeholders do fluxo antigo: status
`pendente`, ID `pendente-*`, endereços de consulta/relatório vazios e nenhum
relatório salvo. Eles nunca receberam protocolo externo e não devem gerar
polling. Jobs reais e relatórios existentes são preservados.

Ao terminar, o card oferece **Refazer análise** e, quando disponível, **Resultado**. A nova análise substitui o registro e relatório anteriores depois que o serviço confirma o início; se a chamada falhar, o resultado anterior é preservado. O HTML externo é servido com sandbox sem scripts. Não há lista de análises nem card de análises no painel de controle. Dados excluídos pela remoção anterior não são recuperados.

### Diagnóstico de comunicação

HTTP 502 indica falha entre a API/proxy e um serviço externo, não necessariamente falha do edital. A interface preserva as mensagens JSON de erro do servidor/n8n e identifica respostas HTML de gateway. Erros de conexão incluem o código de rede; timeouts da API retornam HTTP 504.

Se um job salvo não tiver endereço de consulta/relatório válido, seu
acompanhamento termina com status `erro` e orientação para conferir
`consultar` e `relatorioHtml` no retorno do n8n. O protocolo, os endereços
originais e qualquer relatório salvo são preservados; URLs não são
reconstruídas por suposição. Confirme o estado da execução no n8n antes
de refazer a análise. Ausência de `ANALYSIS_WEBHOOK_URL` na API retorna
503 com orientação de configuração, sem encerrar o job.

O início de análise aguarda até 90 segundos; consultas de status/relatório, 30 segundos. A pesquisa usa limite de 145 segundos na API e 150 segundos no navegador. Não há repetição automática de POST de análise: em caso de timeout, verifique a execução no n8n antes de reenviar, para evitar jobs duplicados e consumo adicional em provedores externos. Um erro `Task execution timed out after 60 seconds` em um nó Code deve ser investigado no executor de tarefas do n8n; aumentar o timeout da interface não corrige esse executor.

O Dockerfile da raiz usa Node para servir a API e a interface; configurações Nginx antigas não fazem parte dessa implantação. Todas as cinco tabelas atuais são usadas: `credentials`, `settings`, `discarded_proposals`, `registered_proposals` e `analysis_jobs`. Contas diferentes e jobs sem proposta agendada não são, por si só, registros órfãos.

### Validação

Execute `npm test` nas pastas `frontend` e `server`, `python -m unittest discover -p 'test_*.py'` em `extractor-service` e `npm run build` em `frontend`. Os testes usam serviços simulados.
