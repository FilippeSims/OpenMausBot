"""Owned, authenticated local Hindsight process. No Docker or system Python."""
import asyncio
import hmac
import json
import logging
import os
from pathlib import Path
import re
import shutil
import sys
import threading

ROOT = Path(__file__).resolve().parent
sys.path[:0] = [str(ROOT), str(ROOT / "site")]


class PrivateMemoryAPI:
    def __init__(self, app, token):
        self.app = app
        self.token = ("Bearer " + token).encode("ascii")

    async def __call__(self, scope, receive, send):
        if scope["type"] == "lifespan":
            return await self.app(scope, receive, send)
        status = 401
        headers = dict(scope.get("headers", []))
        if hmac.compare_digest(headers.get(b"authorization", b""), self.token):
            path = scope.get("path", "")
            method = scope.get("method", "")
            bank = r"/v1/default/banks/omb-[a-z0-9-]+"
            allowed = ((method == "GET" and path == "/health") or
                       (method == "POST" and re.fullmatch(bank + r"/memories(?:/recall)?", path)) or
                       (method == "DELETE" and re.fullmatch(bank + r"/documents/.+", path)))
            if allowed and scope["type"] == "http":
                return await self.app(scope, receive, send)
            status = 404
        if scope["type"] == "websocket":
            return await send({"type": "websocket.close", "code": 1008})
        body = json.dumps({"error": "Unauthorized" if status == 401 else "Unavailable in Mausbot profile"}).encode()
        await send({"type": "http.response.start", "status": status,
                    "headers": [(b"content-type", b"application/json")]})
        await send({"type": "http.response.body", "body": body})


def main():
    # The parent writes credentials through a private pipe, never CLI arguments.
    settings = json.loads(sys.stdin.buffer.readline())
    token = settings["token"]
    if not isinstance(token, str) or len(token) < 32:
        raise ValueError("Missing private runtime credential")
    model = ROOT / "model"
    os.environ.update({
        "HINDSIGHT_API_DATABASE_URL": "pg0://mausbot:" + settings["databaseKey"] + "@mausbot?shared_buffers=32MB&max_connections=32",
        "HINDSIGHT_API_LLM_PROVIDER": "none",
        "HINDSIGHT_API_RETAIN_EXTRACTION_MODE": "chunks",
        "HINDSIGHT_API_EMBEDDINGS_PROVIDER": "onnx",
        "HINDSIGHT_API_EMBEDDINGS_ONNX_MODEL_PATH": str(model / "model_quantized.onnx"),
        "HINDSIGHT_API_EMBEDDINGS_ONNX_TOKENIZER_NAME_OR_PATH": str(model),
        "HINDSIGHT_API_EMBEDDINGS_ONNX_CPU_MEM_ARENA": "false",
        "HINDSIGHT_API_EMBEDDINGS_ONNX_BATCH_SIZE": "1",
        "HINDSIGHT_API_RERANKER_PROVIDER": "rrf",
        "HINDSIGHT_API_ENABLE_OBSERVATIONS": "false",
        "HINDSIGHT_API_MCP_ENABLED": "false",
        "HINDSIGHT_API_WORKER_MAX_SLOTS": "1",
        "HINDSIGHT_API_WORKER_CONSOLIDATION_RESERVED_SLOTS": "0",
        "HINDSIGHT_API_RETAIN_MAX_CONCURRENT": "1",
        "HINDSIGHT_API_LLM_MAX_CONCURRENT": "1",
        "HINDSIGHT_API_DB_POOL_MIN_SIZE": "1",
        "HINDSIGHT_API_DB_POOL_MAX_SIZE": "8",
        "HINDSIGHT_API_READ_DB_POOL_MIN_SIZE": "1",
        "HINDSIGHT_API_READ_DB_POOL_MAX_SIZE": "8",
        "HINDSIGHT_API_OTEL_TRACES_ENABLED": "false",
        "HF_HUB_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1",
        "TOKENIZERS_PARALLELISM": "false",
        "OMP_NUM_THREADS": "2", "OPENBLAS_NUM_THREADS": "2",
    })
    if sys.platform == "darwin":
        # Seed pg0 with the build-time relocated, signed PostgreSQL binaries.
        # They use the OpenSSL libraries in this bundle, not Homebrew paths.
        postgres = Path.home() / ".pg0" / "installation" / "18.1.0"
        marker = postgres / ".mausbot-profile-v1"
        if not marker.exists():
            shutil.copytree(ROOT / "postgres", postgres, dirs_exist_ok=True)
            marker.write_text("18.1.0 relocated OpenSSL profile v1\n")
    logging.basicConfig(level=logging.WARNING)
    from hindsight_api import MemoryEngine
    from hindsight_api.api import create_app
    import uvicorn
    memory = MemoryEngine()
    app = PrivateMemoryAPI(create_app(memory, mcp_api_enabled=False), token)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=settings["port"],
                                          log_level="warning", access_log=False,
                                          loop="asyncio", ws="none", proxy_headers=False,
                                          timeout_graceful_shutdown=5))

    def watch_parent():
        # A raw descriptor avoids Python's buffered-stdin lock during shutdown.
        while os.read(0, 1):
            pass
        server.should_exit = True

    threading.Thread(target=watch_parent, daemon=True).start()
    try:
        server.run()
    finally:
        # Also clean up if startup failed before FastAPI's lifespan yielded.
        postgres = getattr(memory, "_pg0", None)
        if postgres is not None:
            asyncio.run(postgres.stop())


if __name__ == "__main__":
    main()
