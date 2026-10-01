# Site Reactivo de Pregões TIC

Este projeto exibe os resultados do endpoint n8n diretamente em uma interface moderna.

## Instalação

```bash
cd frontend
npm install
```

## Executar localmente

Crie um arquivo `.env.homolog.local` ou `.env.production.local` conforme o ambiente:

```env
VITE_API_BASE_URL=https://seu-webhook-do-ambiente
```

Esses arquivos locais são ignorados pelo Git. Use os comandos correspondentes para iniciar ou gerar a versão desejada:

```bash
npm run dev:homolog
npm run dev:production
npm run build:homolog
npm run build:production
```

## Configurar endpoint

Para homologação local, configure `VITE_API_BASE_URL` em `.env.homolog.local` e inicie com `npm run dev:homolog`.

No EasyPanel, configure somente o serviço de produção com `VITE_API_BASE_URL` apontando para o webhook de produção. O container configura o proxy do Nginx ao iniciar.

O webhook deve permitir a origem pública da aplicação em `Access-Control-Allow-Origin`.
