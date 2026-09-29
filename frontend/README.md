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

Defina `VITE_API_BASE_URL` no arquivo local `.env` ou nas variáveis de ambiente do EasyPanel:

O webhook deve permitir a origem `https://comprasgov.galaxsuport.com.br` em `Access-Control-Allow-Origin`.

Para usar outro endpoint, altere o valor em `.env`:

```env
VITE_API_BASE_URL=https://seu-endpoint
```
