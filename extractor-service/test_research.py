import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
import app


class FakeResponse:
    def __init__(self, body, status_code=200):
        self.body = body
        self.status_code = status_code
        self.is_error = status_code >= 400

    def json(self):
        return self.body


class FakeAsyncClient:
    def __init__(self, response):
        self.response = response
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return None

    async def post(self, url, *, headers, json):
        self.calls.append({"url": url, "headers": headers, "json": json})
        return self.response


class ResearchTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.environment = patch.dict(os.environ, {
            "EXTRACTOR_API_KEY": "fixture-key",
            "OPENROUTER_API_KEY": "openrouter-fixture",
            "OPENROUTER_MODEL": "openrouter/auto",
        })
        self.environment.start()
        self.data = patch.object(app, "DATA", Path(self.directory.name))
        self.data.start()
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app.app),
            base_url="http://test",
            headers={"X-API-Key": "fixture-key"},
        )
        self.job_id = "a" * 32
        app.save({
            "job_id": self.job_id,
            "status": "pronto_para_agente",
            "pesquisas": [],
        }, create=True)

    async def asyncTearDown(self):
        await self.client.aclose()
        self.data.stop()
        self.environment.stop()
        self.directory.cleanup()

    async def test_official_search_uses_web_plugin_and_returns_allowed_citations(self):
        client = FakeAsyncClient(FakeResponse({"choices": [{
            "message": {
                "content": "A fonte oficial confirma o dado.",
                "annotations": [
                    {"type": "url_citation", "url_citation": {
                        "url": "https://www.gov.br/compras/edital",
                        "title": "Portal oficial",
                        "content": "Trecho de evidência oficial.",
                    }},
                    {"type": "url_citation", "url_citation": {
                        "url": "https://gov.br.attacker.example/forged",
                        "title": "Fonte inválida",
                    }},
                    {"type": "url_citation", "url_citation": {
                        "url": "https://revenda.example/produto",
                        "title": "Revendedor",
                    }},
                ],
            },
        }]}))
        with patch.object(app.httpx, "AsyncClient", return_value=client):
            response = await self.client.post(
                f"/jobs/{self.job_id}/pesquisar",
                json={"consulta": "Confirme os dados do edital", "escopo": "oficial"},
            )

        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["resposta"], "A fonte oficial confirma o dado.")
        self.assertEqual([source["url"] for source in result["fontes"]], [
            "https://www.gov.br/compras/edital",
        ])
        self.assertEqual(result["escopo"], "oficial")
        self.assertIn("consultado_em", result)
        call = client.calls[0]
        self.assertEqual(call["url"], "https://openrouter.ai/api/v1/chat/completions")
        self.assertEqual(call["headers"]["Authorization"], "Bearer openrouter-fixture")
        self.assertEqual(call["json"]["model"], "openrouter/auto")
        self.assertEqual(call["json"]["plugins"][0]["id"], "web")
        self.assertIn("include_domains", call["json"]["plugins"][0])
        self.assertEqual(
            len(app.load(self.job_id)["pesquisas"]),
            1,
        )

    async def test_manufacturer_search_keeps_primary_source_citations(self):
        client = FakeAsyncClient(FakeResponse({"choices": [{
            "message": {
                "content": "O manual do fabricante documenta o modelo.",
                "annotations": [{"type": "url_citation", "url_citation": {
                    "url": "https://docs.vendor.example/manual.pdf",
                    "title": "Manual oficial",
                    "content": "Especificação do fabricante.",
                }}],
            },
        }]}))
        with patch.object(app.httpx, "AsyncClient", return_value=client):
            response = await self.client.post(
                f"/jobs/{self.job_id}/pesquisar",
                json={"consulta": "Verifique o modelo e seu manual", "escopo": "fabricante"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["fontes"][0]["url"], "https://docs.vendor.example/manual.pdf")
        self.assertNotIn("include_domains", client.calls[0]["json"]["plugins"][0])

    async def test_openrouter_rate_limit_is_reported_explicitly(self):
        client = FakeAsyncClient(FakeResponse(
            {"error": {"message": "Rate limit exceeded"}},
            status_code=429,
        ))
        with patch.object(app.httpx, "AsyncClient", return_value=client):
            response = await self.client.post(
                f"/jobs/{self.job_id}/pesquisar",
                json={"consulta": "Pesquise a retificação publicada", "escopo": "oficial"},
            )

        self.assertEqual(response.status_code, 503)
        self.assertIn("HTTP 429", response.json()["detail"])
        self.assertIn("Rate limit exceeded", response.json()["detail"])
        self.assertEqual(app.load(self.job_id)["pesquisas"], [])

    async def test_search_requires_openrouter_key(self):
        client = FakeAsyncClient(FakeResponse({}))
        with patch.dict(os.environ, {"OPENROUTER_API_KEY": ""}), \
                patch.object(app.httpx, "AsyncClient", return_value=client):
            response = await self.client.post(
                f"/jobs/{self.job_id}/pesquisar",
                json={"consulta": "Pesquise o edital", "escopo": "oficial"},
            )

        self.assertEqual(response.status_code, 503)
        self.assertIn("OPENROUTER_API_KEY", response.json()["detail"])
        self.assertEqual(client.calls, [])

    async def test_search_rejects_responses_without_verifiable_citations(self):
        client = FakeAsyncClient(FakeResponse({"choices": [{
            "message": {
                "content": "A resposta sem fontes não pode ser confirmada.",
                "annotations": [{
                    "type": "url_citation",
                    "url_citation": {"url": "http://gov.br/inseguro"},
                }],
            },
        }]}))
        with patch.object(app.httpx, "AsyncClient", return_value=client):
            response = await self.client.post(
                f"/jobs/{self.job_id}/pesquisar",
                json={"consulta": "Confirme a situação do pregão", "escopo": "oficial"},
            )

        self.assertEqual(response.status_code, 502)
        self.assertIn("sem citações verificáveis", response.json()["detail"])
        self.assertEqual(app.load(self.job_id)["pesquisas"], [])

    async def test_research_validates_scope_and_existing_job(self):
        invalid_scope = await self.client.post(
            f"/jobs/{self.job_id}/pesquisar",
            json={"consulta": "Pesquisar edital", "escopo": "compras"},
        )
        missing_job = await self.client.post(
            f"/jobs/{'b' * 32}/pesquisar",
            json={"consulta": "Pesquisar edital", "escopo": "oficial"},
        )
        self.assertEqual(invalid_scope.status_code, 422)
        self.assertEqual(missing_job.status_code, 404)


if __name__ == "__main__":
    unittest.main()
