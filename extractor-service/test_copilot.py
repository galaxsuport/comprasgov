import json
import os
import unittest
from unittest.mock import AsyncMock, patch

import httpx
import app


class CopilotTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {
            "COPILOT_BASE_URL": "http://copilot:8080",
            "COPILOT_SERVICE_KEY": "k" * 32,
            "WEB_SEARCH_ENABLED": "true",
            "CHUNK_CHARS": "1000",
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)

    async def test_sends_all_document_parts_to_copilot(self):
        requests = []

        def handle(request):
            requests.append(json.loads(request.content))
            self.assertEqual(str(request.url), "http://copilot:8080/complete")
            self.assertEqual(request.headers["X-API-Key"], "k" * 32)
            return httpx.Response(200, json={"output": "Ficha", "model": "configured-model"})

        client_type = httpx.AsyncClient
        with patch.object(app.httpx, "AsyncClient", side_effect=lambda **kwargs: client_type(transport=httpx.MockTransport(handle))):
            parts = await app.summarize("job1", {"id": "doc1", "nome": "Edital", "url": "https://pncp.gov.br"}, "A" * 1001)
        self.assertEqual(parts, ["Ficha", "Ficha"])
        self.assertTrue(all(request["purpose"] == "summary" for request in requests))
        self.assertTrue(all(request["job_id"] == "job1" and "model" not in request for request in requests))
        self.assertIn("caracteres 0-1000", requests[0]["prompt"])
        self.assertIn("caracteres 1000-1001", requests[1]["prompt"])

    async def test_validates_configuration_and_exposes_copilot_failures(self):
        body = {"messages": [{"content": "system"}, {"content": "prompt"}]}
        for base in ("", "https://user:password@host", "http://copilot/path"):
            with patch.dict(os.environ, {"COPILOT_BASE_URL": base}):
                with self.assertRaisesRegex(ValueError, "COPILOT_BASE_URL"):
                    await app.response_api(body, "job1")
        with patch.dict(os.environ, {"COPILOT_SERVICE_KEY": ""}):
            with self.assertRaisesRegex(ValueError, "COPILOT_SERVICE_KEY"):
                await app.response_api(body, "job1")
        for status, data, expected in (
            (429, {"error": "Serviço ocupado"}, "Copilot HTTP 429: Serviço ocupado"),
            (502, {"error": "Copilot não autenticado"}, "não autenticado"),
            (200, {"output": " "}, "não retornou texto"),
        ):
            client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(status, json=data)))
            with patch.object(app.httpx, "AsyncClient", return_value=client):
                with self.assertRaisesRegex(ValueError, expected):
                    await app.response_api(body, "job1")

    async def test_research_requires_observed_sources_and_preserves_contract(self):
        official = "https://pncp.gov.br/edital"
        vendor = "https://vendor.example.com/manual"
        report = {"resposta": "Dados verificados", "fontes": [
            {"url": official, "title": "Edital", "trecho": "Evidência"},
            {"url": vendor}, {"url": "https://gov.br/unobserved"},
        ]}
        mock = AsyncMock(return_value=(json.dumps(report), {"evidence_urls": [official, vendor]}))
        with patch.object(app, "response_api", mock):
            result = await app.search("job1", "Confirme o edital")
            self.assertEqual(result["fontes"], [report["fontes"][0]])
            self.assertEqual(result["resposta"], report["resposta"])
            self.assertEqual(mock.call_args.kwargs, {"purpose": "research", "scope": "oficial"})
            mock.return_value = (json.dumps(report), {"evidence_urls": []})
            with self.assertRaisesRegex(ValueError, "evidência"):
                await app.search("job1", "Confirme o edital")
            mock.return_value = (json.dumps(report), {"evidence_urls": [vendor]})
            with self.assertRaisesRegex(ValueError, "citações verificáveis"):
                await app.search("job1", "Confirme o edital")
            result = await app.search("job1", "Confirme o manual", "fabricante")
            self.assertEqual(result["fontes"], [{"url": vendor}])
        with patch.dict(os.environ, {"WEB_SEARCH_ENABLED": "false"}):
            with self.assertRaisesRegex(ValueError, "desativada"):
                await app.search("job1", "Consulta")


if __name__ == "__main__":
    unittest.main()
