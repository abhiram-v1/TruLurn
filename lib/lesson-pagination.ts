import { normalizeLessonMarkdown } from '@/lib/lesson-markdown'

const DEFAULT_PAGE_CHAR_LIMIT = 1900

function splitBlocks(markdown: string) {
  return markdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
}

function isHeading(block: string) {
  return /^#{2,4}\s+/.test(block)
}

function isTable(block: string) {
  return block.includes('|') && /\n\s*\|?\s*:?-{3,}/.test(block)
}

export function paginateLessonMarkdown(
  markdown: string,
  charLimit = DEFAULT_PAGE_CHAR_LIMIT,
) {
  const blocks = splitBlocks(normalizeLessonMarkdown(markdown))
  const pages: string[] = []
  let current: string[] = []
  let currentLength = 0

  function commit() {
    if (!current.length) return
    pages.push(current.join('\n\n'))
    current = []
    currentLength = 0
  }

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    const nextBlock = blocks[index + 1]
    const blockWeight = block.length + (isTable(block) ? 650 : 0)

    if (currentLength && currentLength + blockWeight > charLimit) {
      commit()
    }

    if (isHeading(block) && nextBlock && block.length + nextBlock.length < charLimit * 0.7) {
      if (currentLength && currentLength + block.length + nextBlock.length > charLimit) {
        commit()
      }
      current.push(block, nextBlock)
      currentLength += block.length + nextBlock.length
      index += 1
      continue
    }

    current.push(block)
    currentLength += blockWeight

    if (isTable(block) && currentLength > charLimit * 0.7) {
      commit()
    }
  }

  commit()

  return pages.length ? pages : [normalizeLessonMarkdown(markdown)]
}
