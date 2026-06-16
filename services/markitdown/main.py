"""
TruLurn – MarkItDown conversion microservice
Run: uvicorn main:app --host 127.0.0.1 --port 3002

Accepts a multipart file upload, converts it to Markdown via Microsoft's
MarkItDown library, and returns the result as JSON.

Image captioning: MarkItDown's PDF path extracts text only — embedded figures,
charts, and diagrams are dropped. This service additionally extracts those
images (PyMuPDF), normalizes them (Pillow), and describes each with a cheap
vision model (Gemini 2.5 Flash by default), appending the descriptions into the
returned Markdown so they flow into chunking/embeddings/lessons like any other
source text. Everything degrades gracefully: missing dep, missing key, or a
failed call simply skips captioning and returns text as before.
"""

import base64
import hashlib
import io
import json
import os
import pathlib
import tempfile
import urllib.request
from collections import OrderedDict

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from markitdown import MarkItDown

# ── Share the app's API keys without extra setup: load project-root env files ──
try:
    from dotenv import load_dotenv
    _root = pathlib.Path(__file__).resolve().parents[2]
    for _name in (".env.local", ".env.development.local", ".env"):
        _p = _root / _name
        if _p.exists():
            load_dotenv(_p, override=False)
except Exception:
    pass

# PyMuPDF (image extraction) and Pillow (normalization) are optional — without
# them the service still returns text, just no image descriptions.
try:
    import fitz  # PyMuPDF
    _HAS_FITZ = True
except Exception:
    _HAS_FITZ = False

try:
    from PIL import Image
    _HAS_PIL = True
except Exception:
    _HAS_PIL = False

# ── Captioning config (env-overridable) ──
CAPTION_ENABLED = os.getenv("IMAGE_CAPTION_ENABLED", "1") != "0"
CAPTION_PROVIDER = os.getenv("IMAGE_CAPTION_PROVIDER", "gemini").strip().lower()
CAPTION_MODEL = os.getenv("IMAGE_CAPTION_MODEL", "").strip() or (
    "gemini-2.5-flash" if CAPTION_PROVIDER == "gemini" else "gpt-5.4-mini"
)
MAX_IMAGES = int(os.getenv("IMAGE_CAPTION_MAX_IMAGES", "20"))
MIN_AREA = int(os.getenv("IMAGE_CAPTION_MIN_DIM", "128")) ** 2  # skip icons/bullets/logos
MAX_DIM = int(os.getenv("IMAGE_CAPTION_MAX_DIM", "1024"))       # downscale to bound vision cost
CAPTION_TIMEOUT = int(os.getenv("IMAGE_CAPTION_TIMEOUT_MS", "30000")) / 1000
CAPTION_CACHE_MAX = int(os.getenv("IMAGE_CAPTION_CACHE_MAX", "512"))
OPENAI_KEY = os.getenv("OPENAI_API_KEY")
GEMINI_KEY = os.getenv("GOOGLE_GENERATIVE_AI_API_KEY") or os.getenv("GEMINI_API_KEY")

CAPTION_PROMPT = (
    "You are describing an image extracted from a learning document so its content can be "
    "searched and taught. Describe what the image actually conveys: if it is a diagram, chart, "
    "graph, table, equation, screenshot, flow, or labeled figure, explain what it shows — its "
    "components, axes, relationships, and the key takeaway a learner should get from it. Be "
    "factual and concise (2-5 sentences). Do not speculate beyond what is visible. If the image "
    "is purely decorative (logo, divider, background, icon, page furniture) and carries no "
    "learning content, reply with exactly: DECORATIVE"
)

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"}
_caption_cache: OrderedDict[str, str] = OrderedDict()

app = FastAPI(
    title="TruLurn MarkItDown Service",
    description="Converts PDFs, Word docs, PowerPoint, Excel, and images to Markdown (with vision image captions)",
    version="1.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

md = MarkItDown()

SUPPORTED_EXTENSIONS = {
    ".pdf", ".docx", ".pptx", ".xlsx", ".html", ".htm", ".epub",
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp",
}


# ── Vision calls (stdlib only) ────────────────────────────────────────────────
def _caption_gemini(image_b64: str, mime: str) -> str | None:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{CAPTION_MODEL}:generateContent"
    body = {
        "contents": [{"role": "user", "parts": [
            {"text": CAPTION_PROMPT},
            {"inline_data": {"mime_type": mime, "data": image_b64}},
        ]}],
        "generationConfig": {"temperature": 0.2},
    }
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=CAPTION_TIMEOUT) as resp:
        data = json.loads(resp.read())
    cands = data.get("candidates") or []
    if not cands:
        return None
    parts = (cands[0].get("content") or {}).get("parts") or []
    return "".join(p.get("text", "") for p in parts).strip() or None


def _caption_openai(image_b64: str, mime: str) -> str | None:
    url = "https://api.openai.com/v1/responses"
    body = {
        "model": CAPTION_MODEL,
        "input": [{"role": "user", "content": [
            {"type": "input_text", "text": CAPTION_PROMPT},
            {"type": "input_image", "image_url": f"data:{mime};base64,{image_b64}"},
        ]}],
    }
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {OPENAI_KEY}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=CAPTION_TIMEOUT) as resp:
        data = json.loads(resp.read())
    if isinstance(data.get("output_text"), str) and data["output_text"].strip():
        return data["output_text"].strip()
    out = []
    for item in data.get("output", []):
        for content in item.get("content", []):
            if content.get("text"):
                out.append(content["text"])
    return "\n".join(out).strip() or None


def normalize_image(raw: bytes):
    """Re-encode any embedded image to a bounded JPEG the vision APIs accept.
    Returns (jpeg_bytes, area) or (None, 0) if it can't be read."""
    if not _HAS_PIL:
        return None, 0
    try:
        im = Image.open(io.BytesIO(raw))
        area = im.size[0] * im.size[1]
        im = im.convert("RGB")
        if max(im.size) > MAX_DIM:
            im.thumbnail((MAX_DIM, MAX_DIM))
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=85)
        return buf.getvalue(), area
    except Exception:
        return None, 0


def caption_image(raw: bytes) -> str | None:
    """Normalize then caption a single image. Returns None for failures or decorative images."""
    if not CAPTION_ENABLED:
        return None
    cache_key = hashlib.sha256(
        raw + b"\0" + CAPTION_PROVIDER.encode() + b"\0" + CAPTION_MODEL.encode() + b"\0" + CAPTION_PROMPT.encode()
    ).hexdigest()
    if cache_key in _caption_cache:
        cached = _caption_cache.pop(cache_key)
        _caption_cache[cache_key] = cached
        return cached or None
    jpeg, area = normalize_image(raw)
    if not jpeg or area < MIN_AREA:
        return None
    try:
        b64 = base64.b64encode(jpeg).decode()
        if CAPTION_PROVIDER == "openai":
            text = _caption_openai(b64, "image/jpeg") if OPENAI_KEY else None
        else:
            text = _caption_gemini(b64, "image/jpeg") if GEMINI_KEY else None
        result = "" if not text or text.strip().upper().startswith("DECORATIVE") else text.strip()
        _caption_cache[cache_key] = result
        while len(_caption_cache) > CAPTION_CACHE_MAX:
            _caption_cache.popitem(last=False)
        return result or None
    except Exception as exc:  # noqa: BLE001 — one bad image must not fail the doc
        print(f"[caption] failed: {exc}")
        return None


def extract_pdf_image_captions(pdf_path: str):
    """Caption every substantive embedded image in a PDF. Returns [(page_number, caption)]."""
    if not (_HAS_FITZ and CAPTION_ENABLED):
        return []
    captions = []
    seen_hashes = set()
    try:
        doc = fitz.open(pdf_path)
    except Exception as exc:  # noqa: BLE001
        print(f"[caption] cannot open PDF: {exc}")
        return []
    try:
        for page_index in range(len(doc)):
            if len(captions) >= MAX_IMAGES:
                break
            for img in doc[page_index].get_images(full=True):
                if len(captions) >= MAX_IMAGES:
                    break
                xref = img[0]
                try:
                    info = doc.extract_image(xref)
                except Exception:
                    continue
                raw = info.get("image")
                if not raw:
                    continue
                digest = hashlib.md5(raw).hexdigest()
                if digest in seen_hashes:  # repeated header/footer logo — caption once
                    continue
                seen_hashes.add(digest)
                caption = caption_image(raw)
                if caption:
                    captions.append((page_index + 1, caption))
    finally:
        doc.close()
    return captions


def format_captions_section(captions) -> str:
    if not captions:
        return ""
    lines = ["", "", "## Figures and images (described by vision model)", ""]
    for page_no, caption in captions:
        lines.append(f"**Page {page_no} — figure:** {caption}")
        lines.append("")
    return "\n".join(lines).rstrip()


@app.get("/health")
def health():
    """Quick liveness probe — Next.js can ping this on startup."""
    return {
        "ok": True,
        "service": "markitdown",
        "image_captioning": bool(
            CAPTION_ENABLED and _HAS_FITZ and _HAS_PIL
            and ((CAPTION_PROVIDER == "gemini" and GEMINI_KEY) or (CAPTION_PROVIDER == "openai" and OPENAI_KEY))
        ),
        "caption_provider": CAPTION_PROVIDER,
        "caption_model": CAPTION_MODEL,
    }


@app.post("/convert")
async def convert(file: UploadFile):
    """
    Convert an uploaded file to Markdown, enriched with vision descriptions of
    any substantive images.

    Returns:
        { markdown: str, filename: str, chars: int, images_described: int }

    Raises:
        400  – unsupported extension or empty file
        422  – file produced no extractable text AND no describable images
        500  – MarkItDown raised an unexpected error
    """
    filename = file.filename or "upload"
    ext = pathlib.Path(filename).suffix.lower()

    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format '{ext}'. Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail=f"{filename} is empty.")

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        result = md.convert(tmp_path)
        markdown = result.text_content or ""

        # Enrich with image descriptions (best-effort; never fails the request).
        captions = []
        try:
            if ext == ".pdf":
                captions = extract_pdf_image_captions(tmp_path)
            elif ext in IMAGE_EXTENSIONS:
                caption = caption_image(content)
                if caption:
                    captions = [(1, caption)]
        except Exception as exc:  # noqa: BLE001
            print(f"[caption] enrichment skipped: {exc}")

        if captions:
            markdown = (markdown.rstrip() + "\n" + format_captions_section(captions)).strip()

        # Only now decide "no content" — an image-only PDF may have produced no
        # text but still yields describable figures.
        if not markdown.strip():
            raise HTTPException(
                status_code=422,
                detail=f"No text or describable images could be extracted from {filename}. "
                       "The file may be scanned/image-only, encrypted, or unsupported.",
            )

        return {
            "markdown": markdown,
            "filename": filename,
            "chars": len(markdown),
            "images_described": len(captions),
        }

    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Conversion failed for {filename}: {exc}") from exc
    finally:
        os.unlink(tmp_path)
