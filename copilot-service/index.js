import { CopilotClient } from '@github/copilot-sdk';
import { createCopilotServer } from './app.js';

const model = process.env.COPILOT_MODEL ?? 'gpt-5.4';
const client = new CopilotClient({
  ...(process.env.COPILOT_GITHUB_TOKEN
    ? { gitHubToken: process.env.COPILOT_GITHUB_TOKEN, useLoggedInUser: false }
    : {}),
  telemetry: { enabled: false }
});

const server = createCopilotServer({
  client,
  model,
  apiKey: process.env.COPILOT_SERVICE_KEY,
  extractorUrl: process.env.EXTRACTOR_BASE_URL,
  extractorApiKey: process.env.EXTRACTOR_API_KEY
});
await client.start();
const auth = await client.getAuthStatus();
if (!auth.isAuthenticated) {
  console.warn('Copilot ainda não autenticado. Execute o login oficial no console e reinicie o serviço.');
} else if (!(await client.listModels()).some(item => item.id === model)) {
  await client.stop();
  throw new Error(`O modelo ${model} não está disponível para esta conta.`);
}
server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0', () => {
  console.log(`Copilot service pronto; modelo ${model}.`);
});

async function shutdown() {
  server.close(async () => {
    await client.stop();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
