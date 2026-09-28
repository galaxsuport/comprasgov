#!/bin/bash
# AgentGov - Script de Manutenção Automática para Projeto Compras.gov
# Versão: 1.0
# Descrição: Verifica e mantém o estado do projeto React + TypeScript + Vite

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================="
echo "🤖 AgentGov - Verificação do Projeto"
echo "========================================="
echo ""

# 1. Verificar .env file
echo "📁 Verificando configuração .env..."
if [ -f ".env" ]; then
    echo "   ✅ Arquivo .env encontrado"
    ENV_CONTENT=$(cat .env)
    if echo "$ENV_CONTENT" | grep -q "VITE_API_BASE_URL"; then
        echo "   ✅ VITE_API_BASE_URL configurado"
        if echo "$ENV_CONTENT" | grep -q "VITE_USE_MOCK"; then
            echo "   ✅ Modo mock ativado"
        else
            echo "   ℹ️ Modo mock desativado (usando webhook real)"
        fi
    else
        echo "   ❌ VITE_API_BASE_URL não encontrado no .env"
        echo "   💡 Execute: echo 'VITE_API_BASE_URL=https://n8n.galaxsuport.com.br/webhook/50418344-f875-4854-8dd1-b21de2eeadf5' > .env"
    fi
else
    echo "   ❌ Arquivo .env não encontrado"
    echo "   💡 Execute: echo 'VITE_API_BASE_URL=https://n8n.galaxsuport.com.br/webhook/50418344-f875-4854-8dd1-b21de2eeadf5' > .env"
fi
echo ""

# 2. Verificar servidor de desenvolvimento
echo "🚀 Verificando servidor de desenvolvimento..."
if lsof -i :4173 > /dev/null 2>&1; then
    echo "   ✅ Servidor Vite rodando na porta 4173"
    SERVER_URL="http://localhost:4173"
else
    echo "   ❌ Servidor Vite não está rodando"
    echo "   💡 Execute: npm run dev"
fi
echo ""

# 3. Verificar TypeScript compilation
echo "📝 Verificando TypeScript compilation..."
if npx tsc --noEmit 2>&1 | head -5 | grep -q "error"; then
    echo "   ⚠️ Erros de TypeScript encontrados"
    npx tsc --noEmit 2>&1 | head -10
else
    echo "   ✅ Nenhum erro de TypeScript"
fi
echo ""

# 4. Testar endpoint da API
echo "🔗 Testando conexão com webhook..."
WEBHOOK_URL="https://n8n.galaxsuport.com.br/webhook-test/50418344-f875-4854-8dd1-b21de2eeadf5"
if curl -s -o /dev/null -w "%{http_code}" "$WEBHOOK_URL" | grep -q "200\|404"; then
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$WEBHOOK_URL")
    if [ "$HTTP_CODE" = "404" ]; then
        echo "   ⚠️ Webhook retornou 404 (não registrado no n8n)"
        echo "   💡 Clique em 'Executar workflow' no n8n para registrar o webhook"
    else
        echo "   ✅ Webhook acessível (status: $HTTP_CODE)"
    fi
else
    echo "   ❌ Não foi possível conectar ao webhook"
fi
echo ""

# 5. Verificar estrutura de arquivos
echo "📂 Verificando estrutura de arquivos..."
REQUIRED_FILES=("src/App.tsx" "src/api.ts" "src/types.ts" "src/components/ResultCard.tsx" "vite.config.ts" "package.json")
for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "   ✅ $file existe"
    else
        echo "   ❌ $file não encontrado"
    fi
done
echo ""

# 6. Resumo final
echo "========================================="
echo "📊 Resumo da Verificação"
echo "========================================="
echo ""

echo "Próximos passos recomendados:"

if ! lsof -i :4173 > /dev/null 2>&1; then
    echo "1. 🚀 Inicie o servidor: npm run dev"
fi

if echo "$ENV_CONTENT" | grep -q "404"; then
    echo "2. 🔧 Registre o webhook no n8n: Clique em 'Executar workflow'"
fi

echo "3. 🧪 Teste os filtros: Ajuste UFs, modalidades, dias e prazo"
echo "4. 📊 Verifique a exibição nos ResultCards"

echo ""
echo "========================================="
echo "Fim da verificação do AgentGov"
echo "========================================="