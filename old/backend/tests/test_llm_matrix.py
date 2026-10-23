import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from app.llm.base import OpenAICompatClient


class Handler(BaseHTTPRequestHandler):
    """Fake provider: answers a plain 'OK' unless the request carries GitHub's version header."""

    def do_GET(self):
        self._send(200, json.dumps({"ok": True}), "application/json")

    def do_POST(self):
        self.rfile.read(int(self.headers["Content-Length"]))
        if self.headers.get("X-GitHub-Api-Version") == "2026-03-10":
            self._send(200, json.dumps({"choices": [{"message": {"content": "ok"}}]}), "application/json")
        else:
            self._send(200, "OK\r\n", "text/plain")

    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, *a):
        pass


def test_matrix_shows_which_request_shape_works():
    srv = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_port}"
    client = OpenAICompatClient(name="github-models", url=f"{base}/inference/chat/completions", api_key="secret-token",
                                model="openai/gpt-4o-mini",
                                extra_headers={"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"})
    rows = asyncio.run(client.probe_matrix(github=True, control_url=f"{base}/rate_limit"))
    by = {r["variant"]: r for r in rows}
    assert by["configured request"]["json"] is False and by["configured request"]["preview"].startswith("OK")
    assert by["GitHub headers, api version 2026-03-10"]["hasChoices"] is True
    assert by["model catalog (token accepted?)"]["status"] == 200
    assert "secret-token" not in json.dumps(rows)
    srv.shutdown()
