"""
TruLurn – MarkItDown conversion microservice
Run: uvicorn main:app --host 127.0.0.1 --port 3002

Accepts a multipart file upload, converts it to Markdown via Microsoft's
MarkItDown library, and returns the result as JSON.
"""

import os
import pathlib
import tempfile

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from markitdown import MarkItDown

app = FastAPI(
    title="TruLurn MarkItDown Service",
    description="Converts PDFs, Word docs, PowerPoint, Excel, and more to Markdown",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

md = MarkItDown()

SUPPORTED_EXTENSIONS = {
    ".pdf",
    ".docx",
    ".pptx",
    ".xlsx",
    ".html",
    ".htm",
    ".epub",
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".bmp",
    ".webp",
}


@app.get("/health")
def health():
    """Quick liveness probe — Next.js can ping this on startup."""
    return {"ok": True, "service": "markitdown"}


@app.post("/convert")
async def convert(file: UploadFile):
    """
    Convert an uploaded file to Markdown.

    Returns:
        { markdown: str, filename: str, chars: int }

    Raises:
        400  – unsupported extension or empty file
        422  – file parsed but produced no extractable text
        500  – MarkItDown raised an unexpected error
    """
    filename = file.filename or "upload"
    ext = pathlib.Path(filename).suffix.lower()

    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported format '{ext}'. "
                f"Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}"
            ),
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail=f"{filename} is empty.")

    # Write to a temp file — MarkItDown works from file paths, not streams.
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        result = md.convert(tmp_path)
        markdown = result.text_content or ""

        if not markdown.strip():
            raise HTTPException(
                status_code=422,
                detail=f"No text could be extracted from {filename}. "
                       "The file may be scanned/image-only or encrypted.",
            )

        return {
            "markdown": markdown,
            "filename": filename,
            "chars": len(markdown),
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Conversion failed for {filename}: {exc}",
        ) from exc
    finally:
        os.unlink(tmp_path)
