"""
EmbedAPI - local text-embedding sidecar (multilingual MiniLM via fastembed).

Same trust model as NSFWAPI: lives on the private docker network, never
published to the internet. Every request must carry X-Internal-Secret;
GoUpload is the only caller. Stateless text -> 384-dim vector, no DB access.

Model note: paraphrase-multilingual-MiniLM-L12-v2 covers 50+ languages at the
SAME 384 dimensions as the old bge-small-en-v1.5, so vector(384) columns and
every RPC stay untouched. Vectors from the two models are NOT comparable -
after switching, re-embed every stored vector (scripts/reembed-files).
"""

import hmac
import os
import logging

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field


def _load_env_files() -> None:
    """Tiny stdlib .env loader for bare `python main.py` runs.

    Docker injects env via compose, so this is a no-op there. Locally we read
    EmbedAPI/.env first, then GoUpload/.env (where EMBED_API_SECRET lives, the
    same file compose interpolates). Real environment variables always win.
    """
    here = os.path.dirname(os.path.abspath(__file__))
    for path in (os.path.join(here, ".env"), os.path.join(here, "..", ".env")):
        try:
            # utf-8-sig: tolerate a BOM from Windows editors.
            with open(path, encoding="utf-8-sig") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, value = line.partition("=")
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    if key and key not in os.environ:
                        os.environ[key] = value
        except OSError:
            continue


_load_env_files()

MODEL_NAME = os.environ.get("EMBED_MODEL", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")
PORT = int(os.environ.get("EMBED_API_PORT", "3007"))
SECRET = os.environ.get("EMBED_API_SECRET", "")
# Keep ONNX polite on shared vCPUs; a single short sentence embeds in ~10ms anyway.
THREADS = int(os.environ.get("EMBED_THREADS", "1"))

MAX_TEXTS = 32
MAX_TEXT_CHARS = 4000

logging.basicConfig(level=logging.INFO, format="[embedapi] %(message)s")
log = logging.getLogger("embedapi")

if not SECRET:
    raise SystemExit("EMBED_API_SECRET must be set - refusing to start without auth")

from fastembed import TextEmbedding  # noqa: E402  (import after env validation)

log.info("loading model %s (threads=%d)...", MODEL_NAME, THREADS)
model = TextEmbedding(model_name=MODEL_NAME, threads=THREADS)
DIM = len(next(iter(model.embed(["warmup"]))))
log.info("model ready dim=%d", DIM)

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


class EmbedRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=MAX_TEXTS)
    # "query" = user searches, "passage" = documents (titles/descriptions at
    # upload). fastembed applies whatever prefixing the active model needs; for
    # the multilingual MiniLM both paths embed plain text.
    kind: str = "passage"


def check_secret(provided: str | None) -> None:
    if not provided or not hmac.compare_digest(provided, SECRET):
        raise HTTPException(status_code=401, detail="unauthorized")


@app.post("/embed")
def embed(req: EmbedRequest, x_internal_secret: str | None = Header(default=None)):
    check_secret(x_internal_secret)

    texts = [t.strip()[:MAX_TEXT_CHARS] for t in req.texts]
    if any(not t for t in texts):
        raise HTTPException(status_code=400, detail="empty text")

    if req.kind == "query":
        vectors = list(model.query_embed(texts))
    else:
        vectors = list(model.embed(texts))

    return {
        "model": MODEL_NAME,
        "dim": DIM,
        "vectors": [[round(float(x), 6) for x in v] for v in vectors],
    }


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_NAME, "dim": DIM}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning")
