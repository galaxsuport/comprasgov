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

O endpoint padrão usado é:

`https://n8n.galaxsuport.com.br/webhook/50418344-f875-4854-8dd1-b21de2eeadf5`

O webhook deve permitir a origem `https://comprasgov.galaxsuport.com.br` em `Access-Control-Allow-Origin`.

Se quiser usar outro endpoint, defina em `.env`:

```env
VITE_API_BASE_URL=https://seu-endpoint
```
