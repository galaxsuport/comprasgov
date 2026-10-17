import asyncio
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
import app


class CancelTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.environment = patch.dict(os.environ, {"EXTRACTOR_API_KEY": "fixture-key"})
        self.environment.start()
        self.data = patch.object(app, "DATA", Path(self.directory.name))
        self.data.start()
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app.app),
            base_url="http://test", headers={"X-API-Key": "fixture-key"})

    async def asyncTearDown(self):
        await self.client.aclose()
        self.data.stop()
        self.environment.stop()
        self.directory.cleanup()

    async def test_cancels_queued_job_and_removes_only_its_data(self):
        started = asyncio.Event()
        stopped = asyncio.Event()

        async def collect(job_id):
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                stopped.set()

        with patch.object(app, "collect", collect):
            response = await self.client.post("/jobs", json={
                "url": "https://pncp.gov.br/app/editais/12345678000199/2027/1"})
            job_id = response.json()["job_id"]
            await started.wait()
            saved = app.load(job_id)
            target = app.DATA / job_id
            target.mkdir()
            (target / "dossie.json").write_text("fixture")
            other = app.DATA / ("b" * 32)
            other.mkdir()
            (other / "keep.txt").write_text("preserve")
            self.assertEqual((await self.client.delete(f"/jobs/{job_id}", headers={"X-API-Key": "wrong"})).status_code, 401)
            self.assertTrue((await self.client.delete(f"/jobs/{job_id}")).json()["cancelled"])
            self.assertTrue(stopped.is_set())
            self.assertFalse(target.exists())
            self.assertTrue((other / "keep.txt").exists())
            self.assertNotIn(job_id, app.TASKS)
            self.assertEqual((await self.client.get(f"/jobs/{job_id}")).status_code, 404)
            self.assertEqual((await self.client.post(f"/jobs/{job_id}/resultado", json={"relatorio": "late"})).status_code, 404)
            with self.assertRaises(app.HTTPException):
                app.save(saved)
            self.assertTrue((await self.client.delete(f"/jobs/{job_id}")).json()["cancelled"])
            self.assertEqual((await self.client.delete("/jobs/not-an-id")).status_code, 422)

    async def test_research_endpoint_returns_not_found_for_missing_job(self):
        response = await self.client.post(
            f"/jobs/{'a' * 32}/pesquisar", json={"consulta": "fixture"})
        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
