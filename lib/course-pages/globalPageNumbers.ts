type OrderedTopicLike = {
  _id?: unknown
  id?: unknown
  branch_id?: unknown
  branch_position?: unknown
  position?: unknown
  estimated_pages?: unknown
  total_pages_planned?: unknown
  node_type?: unknown
  children_count?: unknown
  sequence_index?: unknown
  created_at?: unknown
}

type OrderedBranchLike = {
  _id?: unknown
  branch_key?: unknown
  position?: unknown
  created_at?: unknown
}

function asId(value: unknown) {
  return String(value ?? '')
}

function asNumber(value: unknown, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function asTime(value: unknown) {
  if (value instanceof Date) return value.getTime()
  const time = Date.parse(String(value ?? ''))
  return Number.isFinite(time) ? time : 0
}

export function plannedPageCount(topic: OrderedTopicLike, minimum = 1) {
  const isContainer = String(topic.node_type ?? '') === 'container' || asNumber(topic.children_count, 0) > 0
  if (isContainer) return 0

  const planned = asNumber(topic.estimated_pages ?? topic.total_pages_planned, minimum)
  return Math.min(15, Math.max(minimum, planned))
}

function createBranchOrder(branches?: OrderedBranchLike[]) {
  const order = new Map<string, number>()
  if (!branches?.length) return order

  const sortedBranches = [...branches].sort((a, b) => {
    const position = asNumber(a.position, Number.NaN) - asNumber(b.position, Number.NaN)
    if (Number.isFinite(position) && position !== 0) return position

    return asTime(a.created_at) - asTime(b.created_at)
  })

  sortedBranches.forEach((branch, index) => {
    const id = asId(branch._id)
    const key = asId(branch.branch_key)
    if (id) order.set(id, index)
    if (key) order.set(key, index)
  })

  return order
}

export function sortCourseTopics<T extends OrderedTopicLike>(
  topics: T[],
  branches?: OrderedBranchLike[],
) {
  const branchOrder = createBranchOrder(branches)

  return [...topics].sort((a, b) => {
    const aBranchId = asId(a.branch_id)
    const bBranchId = asId(b.branch_id)
    const aBranchOrder = branchOrder.get(aBranchId)
    const bBranchOrder = branchOrder.get(bBranchId)

    if (aBranchOrder !== undefined || bBranchOrder !== undefined) {
      return (aBranchOrder ?? Number.MAX_SAFE_INTEGER) - (bBranchOrder ?? Number.MAX_SAFE_INTEGER)
    }

    const branchPosition = asNumber(a.branch_position, Number.NaN) - asNumber(b.branch_position, Number.NaN)
    if (Number.isFinite(branchPosition) && branchPosition !== 0) return branchPosition

    const branchId = aBranchId.localeCompare(bBranchId)
    if (branchId !== 0) return branchId

    const sequence = asNumber(a.sequence_index, Number.NaN) - asNumber(b.sequence_index, Number.NaN)
    if (Number.isFinite(sequence) && sequence !== 0) return sequence

    const position = asNumber(a.position) - asNumber(b.position)
    if (position !== 0) return position

    return asTime(a.created_at) - asTime(b.created_at)
  })
}

export function computeGlobalPagePosition({
  topics,
  topicId,
  pageNumber,
  branches,
}: {
  topics: OrderedTopicLike[]
  topicId: string
  pageNumber: number
  branches?: OrderedBranchLike[]
}) {
  const orderedTopics = sortCourseTopics(topics, branches)
  const safePageNumber = Math.max(1, Number(pageNumber) || 1)
  let runningTotal = 0
  let globalPageNumber = safePageNumber
  let topicIndex = -1

  for (const topic of orderedTopics) {
    const id = asId(topic._id ?? topic.id)
    const isCurrentTopic = id === topicId
    const topicPages = plannedPageCount(topic, isCurrentTopic ? safePageNumber : 1)

    if (isCurrentTopic) {
      globalPageNumber = runningTotal + safePageNumber
      topicIndex = orderedTopics
        .filter((item) => plannedPageCount(item) > 0)
        .findIndex((item) => asId(item._id ?? item.id) === topicId)
    }

    runningTotal += topicPages
  }

  return {
    globalPageNumber: Math.max(1, globalPageNumber),
    globalPageTotal: Math.max(globalPageNumber, runningTotal, 1),
    topicIndex,
    orderedTopics,
  }
}

export function findTopicPageByGlobalNumber({
  topics,
  globalPageNumber,
  branches,
}: {
  topics: OrderedTopicLike[]
  globalPageNumber: number
  branches?: OrderedBranchLike[]
}) {
  const target = Math.max(1, Number(globalPageNumber) || 1)
  const orderedTopics = sortCourseTopics(topics, branches)
  let runningTotal = 0

  for (const topic of orderedTopics) {
    const topicPages = plannedPageCount(topic)
    if (topicPages <= 0) continue

    const start = runningTotal + 1
    const end = runningTotal + topicPages

    if (target >= start && target <= end) {
      return {
        topic,
        topicId: asId(topic._id ?? topic.id),
        pageNumber: target - runningTotal,
        topicStartPage: start,
        topicEndPage: end,
      }
    }

    runningTotal += topicPages
  }

  return null
}
