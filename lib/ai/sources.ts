import type { CurriculumMode } from '@/lib/ai/skills/types'

const TEXT_EXTENSIONS = ['.txt', '.md', '.markdown', '.json', '.csv']

export type SourceExtraction = {
  sourceText: string
  limitations: string[]
}

export function isTextSource(file: File): boolean {
  const name = file.name.toLowerCase()

  return file.type.startsWith('text/') || TEXT_EXTENSIONS.some((extension) => name.endsWith(extension))
}

export async function extractSourceTextFromFormData(formData: FormData): Promise<SourceExtraction> {
  const limitations: string[] = []
  const chunks: string[] = []

  for (const [key, value] of formData.entries()) {
    if (!(value instanceof File) || key !== 'sources') continue

    if (!isTextSource(value)) {
      limitations.push(`${value.name} was not read. MVP source upload currently supports txt, md, json, and csv files.`)
      continue
    }

    const text = await value.text()
    if (!text.trim()) {
      limitations.push(`${value.name} was empty.`)
      continue
    }

    chunks.push(`Source: ${value.name}\n${text.trim()}`)
  }

  return {
    sourceText: chunks.join('\n\n---\n\n'),
    limitations,
  }
}

export function normalizeCurriculumMode(value: FormDataEntryValue | string | null | undefined): CurriculumMode {
  return value === 'source_grounded' ? 'source_grounded' : 'ai_teacher'
}
