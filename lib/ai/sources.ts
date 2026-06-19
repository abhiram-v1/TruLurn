import type { CurriculumMode } from '@/lib/ai/skills/types'

const TEXT_EXTENSIONS = ['.txt', '.md', '.markdown', '.json', '.csv']
const RICH_EXTENSIONS = ['.pdf', '.docx', '.pptx', '.xlsx', '.html', '.htm', '.epub']

export type SourceExtraction = {
  sourceText: string
  limitations: string[]
}

/** An image extracted from a source document, returned by the MarkItDown service. */
export type ExtractedSourceImage = {
  page: number
  order: number
  caption: string
  classification: string
  chart_type: string
  ocr_text: string
  relevance: number
  figure_label: string
  nearby_text: string
  content_hash: string
  width?: number
  height?: number
  mime?: string
  /** base64-encoded display JPEG bytes (absent when the service is text-only). */
  data?: string
}

export type SourceFileExtraction = {
  text: string | null
  limitation: string | null
  images: ExtractedSourceImage[]
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
export type MarkItDownResult = {
  markdown: string
  images: ExtractedSourceImage[]
  error?: string
}

export async function convertViaMarkItDown(file: File): Promise<MarkItDownResult | null> {
  const serviceUrl = process.env.MARKITDOWN_SERVICE_URL
    ?? (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:3002' : undefined)
  if (!serviceUrl) return null

  // Image-heavy PDFs run several vision captioning calls inside the service, so
  // allow generous headroom (override with MARKITDOWN_TIMEOUT_MS).
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Number(process.env.MARKITDOWN_TIMEOUT_MS ?? 180_000))

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
      const errMsg = (err as { detail?: string }).detail ?? res.statusText
      console.warn(`[MarkItDown] ${file.name}: ${errMsg}`)
      return { markdown: '', images: [], error: errMsg }
    }

    const data = (await res.json()) as { markdown?: string; images?: ExtractedSourceImage[] }
    const markdown = typeof data.markdown === 'string' ? data.markdown.trim() : ''
    const images = Array.isArray(data.images) ? data.images : []
    if (!markdown && !images.length) return { markdown: '', images: [], error: 'No text or images could be extracted.' }
    return { markdown, images }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e)
    console.warn(`[MarkItDown] Service unreachable for ${file.name}:`, e)
    return { markdown: '', images: [], error: `service unreachable (${errMsg})` }
  } finally {
    clearTimeout(timeout)
  }
}

export async function extractTextFromSourceFile(file: File): Promise<SourceFileExtraction> {
  if (isTextSource(file)) {
    const text = await file.text()
    return text.trim()
      ? { text: text.trim(), limitation: null, images: [] }
      : { text: null, limitation: `${file.name} was empty.`, images: [] }
  }

  if (isRichSource(file)) {
    const converted = await convertViaMarkItDown(file)
    if (converted && (converted.markdown || converted.images.length)) {
      return { text: converted.markdown.trim() || null, limitation: null, images: converted.images }
    }

    const serviceConfigured = Boolean(
      process.env.MARKITDOWN_SERVICE_URL || process.env.NODE_ENV === 'development',
    )
    const reason = converted?.error ? ` - ${converted.error}` : ' - unknown error'
    return {
      text: null,
      images: [],
      limitation: serviceConfigured
        ? `${file.name} could not be converted${reason}`
        : `${file.name} was skipped - rich document conversion is not configured. Start the MarkItDown service and set MARKITDOWN_SERVICE_URL.`,
    }
  }

  return {
    text: null,
    images: [],
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
      const converted = await convertViaMarkItDown(value)
      const markdown = converted?.markdown ?? ''

      if (markdown) {
        chunks.push(`${sourceHeader}\n${markdown.trim()}`)
      } else if (!process.env.MARKITDOWN_SERVICE_URL) {
        limitations.push(
          `${value.name} was skipped — rich document conversion is not configured. ` +
          `Start the MarkItDown service and set MARKITDOWN_SERVICE_URL.`
        )
      } else {
        const reason = converted?.error ? ` — ${converted.error}` : ''
        limitations.push(
          `${value.name} could not be converted${reason}`
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
