export type CurriculumGraphTopic = {
  id: string
  title: string
  description: string
  branch_id: string
  branch_title: string
  section: string
  parent_id: string | null
  path_ids: string[]
  path_titles: string[]
  depth_level: number
  node_type: string
  prerequisites: string[]
  prerequisite_strength: Record<string, string>
  estimated_pages: number
  depth: string
  importance: string
  role: string
  spine_candidate: boolean
  spine_level: number
  source_anchor: string | null
  source_coverage: string | null
  concept_group: string | null
}

export type CurriculumGraphBranch = {
  id: string
  title: string
  description: string
}

export function flattenCurriculumForGraph(curriculum: any) {
  const branches: CurriculumGraphBranch[] = []
  const topics: CurriculumGraphTopic[] = []

  for (const branch of Array.isArray(curriculum?.branches) ? curriculum.branches : []) {
    const branchId = String(branch?.id ?? '').trim()
    if (!branchId) continue
    const branchTitle = String(branch?.title ?? branchId).trim()
    branches.push({
      id: branchId,
      title: branchTitle,
      description: String(branch?.description ?? branchTitle).trim(),
    })

    const visit = (
      topic: any,
      section: string,
      parentId: string | null,
      pathIds: string[],
      pathTitles: string[],
    ) => {
      const id = String(topic?.id ?? '').trim()
      if (!id) return
      const title = String(topic?.title ?? id).trim()
      const nextPathIds = [...pathIds, id]
      const nextPathTitles = [...pathTitles, title]
      const children = Array.isArray(topic?.children) ? topic.children : []
      topics.push({
        id,
        title,
        description: String(topic?.description ?? '').trim(),
        branch_id: branchId,
        branch_title: branchTitle,
        section,
        parent_id: parentId,
        path_ids: nextPathIds,
        path_titles: nextPathTitles,
        depth_level: nextPathIds.length - 1,
        node_type: String(topic?.node_type ?? (children.length ? 'container' : 'learning_unit')),
        prerequisites: Array.isArray(topic?.prerequisites) ? topic.prerequisites.map(String) : [],
        prerequisite_strength: topic?.prerequisite_strength && typeof topic.prerequisite_strength === 'object'
          ? topic.prerequisite_strength
          : {},
        estimated_pages: Math.max(0, Number(topic?.estimated_pages ?? 0)),
        depth: String(topic?.depth ?? 'medium'),
        importance: String(topic?.importance ?? 'supporting'),
        role: String(topic?.role ?? 'theory'),
        spine_candidate: Boolean(topic?.spine_candidate),
        spine_level: Number.isFinite(topic?.spine_level) ? Number(topic.spine_level) : 0,
        source_anchor: String(topic?.source_anchor ?? '').trim() || null,
        source_coverage: String(topic?.source_coverage ?? '').trim() || null,
        concept_group: String(topic?.concept_group ?? '').trim() || null,
      })
      children.forEach((child: any) => visit(
        child,
        section,
        id,
        nextPathIds,
        nextPathTitles,
      ))
    }

    for (const section of Array.isArray(branch?.sections) ? branch.sections : []) {
      const sectionTitle = String(section?.title ?? 'Core').trim()
      for (const topic of Array.isArray(section?.topics) ? section.topics : []) {
        visit(topic, sectionTitle, null, [], [])
      }
    }
  }

  return {
    title: String(curriculum?.title ?? 'Untitled course'),
    source_sequence_policy: String(curriculum?.source_sequence_policy ?? ''),
    branches,
    topics,
  }
}
