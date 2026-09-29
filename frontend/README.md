# Site Reactivo de Pregões TIC

Este projeto exibe os resultados do endpoint n8n diretamente em uma interface moderna.

## Instalação

```bash
cd frontend
npm install
```

## Executar localmente

```bash
npm run dev
```

## Configurar endpoint

Copie `.env.example` para `.env` e ajuste `VITE_API_BASE_URL` conforme o webhook usado:

```bash
cp .env.example .env
```

O exemplo já aponta para o webhook de produção da GALAX Suport.

O webhook deve permitir a origem `https://comprasgov.galaxsuport.com.br` em `Access-Control-Allow-Origin`.

Para usar outro endpoint, altere o valor em `.env`:

```env
VITE_API_BASE_URL=https://seu-endpoint
```
