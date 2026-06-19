import { normalizeLessonMarkdown } from '@/lib/lesson-markdown'

const DEFAULT_PAGE_CHAR_LIMIT = 1900

function splitBlocks(markdown: string) {
  const source = normalizeLessonMarkdown(markdown)
  const blocks: string[] = []
  const lines = source.split(/\r?\n/)
  let current: string[] = []
  let table: string[] = []

  function flushCurrent() {
    const block = current.join('\n').trim()
    if (block) blocks.push(block)
    current = []
  }

  function flushTable() {
    const block = table.join('\n').trim()
    if (block) blocks.push(block)
    table = []
  }

  for (const line of lines) {
    const isTableLine = /^\s*\|.*\|\s*$/.test(line)
    if (isTableLine) {
      flushCurrent()
      table.push(line)
      continue
    }

    if (table.length) flushTable()

    if (!line.trim()) {
      flushCurrent()
      continue
    }

    current.push(line)
  }

  flushTable()
  flushCurrent()
  return blocks
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
  const blocks = splitBlocks(markdown)
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

    // Calculate total remaining weight from current block to the end
    let remainingWeight = 0
    for (let j = index; j < blocks.length; j += 1) {
      remainingWeight += blocks[j].length + (isTable(blocks[j]) ? 650 : 0)
    }

    // Dynamic boundary: if the remaining blocks are small enough or if they
    // fit within a 30% overflow margin of the current page, append them all and finish.
    const isSmallOverflow = currentLength + remainingWeight <= charLimit * 1.3
    const isFewContentsLeft = remainingWeight < Math.max(400, charLimit * 0.25)

    if (currentLength && (isSmallOverflow || isFewContentsLeft)) {
      for (let j = index; j < blocks.length; j += 1) {
        current.push(blocks[j])
      }
      break
    }

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
