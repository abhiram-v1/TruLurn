import type { CurriculumMode } from '@/lib/ai/skills/types'

const TEXT_EXTENSIONS = ['.txt', '.md', '.markdown', '.json', '.csv']
const RICH_EXTENSIONS = ['.pdf', '.docx', '.pptx', '.xlsx', '.html', '.htm', '.epub']

export type SourceExtraction = {
  sourceText: string
  limitations: string[]
}

export type SourceFileExtraction = {
  text: string | null
  limitation: string | null
}

export function isTextSource(file: File): boolean {
  const name = file.name.toLowerCase()
  return file.type.startsWith('text/') || TEXT_EXTENSIONS.some((ext) => name.endsWith(ext))
}

export function isRichSource(file: File): boolean {
  const name = file.name.toLowerCase()
  return RICH_EXTENSIONS.some((ext) => name.endsWith(ext))
}

/**
 * Send a rich document (PDF, DOCX, PPTX, etc.) to the local MarkItDown
 * microservice and return the converted Markdown text.
 *
 * Returns null when:
 *  - MARKITDOWN_SERVICE_URL is not set (service not configured)
 *  - The service is unreachable (not running)
 *  - The service returned a non-OK response
 */
export async function convertViaMarkItDown(file: File): Promise<string | null> {
  const serviceUrl = process.env.MARKITDOWN_SERVICE_URL
    ?? (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:3002' : undefined)
  if (!serviceUrl) return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)

  try {
    const form = new FormData()
    form.append('file', file)

    const res = await fetch(`${serviceUrl}/convert`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      console.warn(`[MarkItDown] ${file.name}: ${(err as { detail?: string }).detail ?? res.statusText}`)
      return null
    }

    const data = (await res.json()) as { markdown?: string }
    return typeof data.markdown === 'string' && data.markdown.trim() ? data.markdown : null
  } catch (e) {
    console.warn(`[MarkItDown] Service unreachable for ${file.name}:`, e)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

export async function extractTextFromSourceFile(file: File): Promise<SourceFileExtraction> {
  if (isTextSource(file)) {
    const text = await file.text()
    return text.trim()
      ? { text: text.trim(), limitation: null }
      : { text: null, limitation: `${file.name} was empty.` }
  }

  if (isRichSource(file)) {
    const markdown = await convertViaMarkItDown(file)
    if (markdown) return { text: markdown.trim(), limitation: null }

    const serviceConfigured = Boolean(
      process.env.MARKITDOWN_SERVICE_URL || process.env.NODE_ENV === 'development',
    )
    return {
      text: null,
      limitation: serviceConfigured
        ? `${file.name} could not be converted - the MarkItDown service is unavailable or returned no text.`
        : `${file.name} was skipped - rich document conversion is not configured. Start the MarkItDown service and set MARKITDOWN_SERVICE_URL.`,
    }
  }

  return {
    text: null,
    limitation:
      `${file.name}: unsupported format. ` +
      'Upload text, Markdown, JSON, CSV, PDF, Word (.docx), PowerPoint (.pptx), or Excel (.xlsx) files.',
  }
}

export async function extractSourceTextFromFormData(formData: FormData): Promise<SourceExtraction> {
  const limitations: string[] = []
  const chunks: string[] = []
  let sourceIndex = 0

  for (const [key, value] of formData.entries()) {
    if (!(value instanceof File) || key !== 'sources') continue
    sourceIndex += 1
    const sourceHeader = `Source ${sourceIndex}: ${value.name}`

    // ── Plain text files — read directly ─────────────────────────────────────
    if (isTextSource(value)) {
      const text = await value.text()
      if (!text.trim()) {
        limitations.push(`${value.name} was empty.`)
        continue
      }
      chunks.push(`${sourceHeader}\n${text.trim()}`)
      continue
    }

    // ── Rich documents — convert via MarkItDown service ──────────────────────
    if (isRichSource(value)) {
      const markdown = await convertViaMarkItDown(value)

      if (markdown) {
        chunks.push(`${sourceHeader}\n${markdown.trim()}`)
      } else if (!process.env.MARKITDOWN_SERVICE_URL) {
        limitations.push(
          `${value.name} was skipped — rich document conversion is not configured. ` +
          `Start the MarkItDown service and set MARKITDOWN_SERVICE_URL.`
        )
      } else {
        limitations.push(
          `${value.name} could not be converted — the MarkItDown service is unavailable or returned no text.`
        )
      }
      continue
    }

    // ── Unsupported ───────────────────────────────────────────────────────────
    limitations.push(
      `${value.name}: unsupported format. ` +
      `Upload text, Markdown, JSON, CSV, PDF, Word (.docx), PowerPoint (.pptx), or Excel (.xlsx) files.`
    )
  }

  return {
    sourceText: chunks.join('\n\n---\n\n'),
    limitations,
  }
}

export function normalizeCurriculumMode(value: FormDataEntryValue | string | null | undefined): CurriculumMode {
  return value === 'source_grounded' ? 'source_grounded' : 'ai_teacher'
}
