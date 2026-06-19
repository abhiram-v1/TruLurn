// Analyzes user interactions to determine if they contain graph-relevant
// information and extracts entities/relationships for the graph manager.

import { generateAI, parseAIJson } from '@/lib/ai'
import type { GraphElementReviewState } from './types'

export interface ExtractedEntity {
  conceptLabel: string
  topicId: string | null
  reviewState: GraphElementReviewState
  confidence: number  // 0–100
  type: 'topic' | 'concept' | 'skill' | 'preference' | 'observation'
}

export interface ExtractedRelationship {
  fromLabel: string
  toLabel: string
  relationshipType: 'prerequisite' | 'related' | 'contrasts' | 'builds_on' | 'applies' | 'semantic'
  confidence: number  // 0–100
  note?: string
}

export interface InteractionAnalysisResult {
  is_update_graph: boolean
  entities: ExtractedEntity[]
  relationships: ExtractedRelationship[]
  source: string
}

const EMPTY_RESULT = (source: string): InteractionAnalysisResult => ({
  is_update_graph: false,
  entities: [],
  relationships: [],
  source,
})

export async function analyzeInteractionForGraph(params: {
  message: string
  topicTitle: string
  courseTitle: string
  source: 'doubt' | 'feedback' | 'discussion' | 'action'
}): Promise<InteractionAnalysisResult> {
  const { message, topicTitle, courseTitle, source } = params

  if (message.trim().length < 10) return EMPTY_RESULT(source)

  const systemPrompt = `You analyze learner messages to extract knowledge-graph-relevant information.
Return ONLY valid JSON:
{
  "is_update_graph": boolean,
  "entities": [
    {
      "conceptLabel": string,
      "topicId": null,
      "reviewState": "proposed"|"inferred"|"observed"|"confirmed",
      "confidence": number (0-100),
      "type": "concept"|"skill"|"preference"|"observation"
    }
  ],
  "relationships": [
    {
      "fromLabel": string,
      "toLabel": string,
      "relationshipType": "prerequisite"|"related"|"contrasts"|"builds_on"|"applies"|"semantic",
      "confidence": number (0-100),
      "note": string
    }
  ]
}

Set is_update_graph=true when the message reveals: concepts the learner understands or is confused about, connections the learner makes between ideas, misconceptions, goals, or explicit knowledge claims about the subject.
Set is_update_graph=false for: navigation requests, greetings, technical/UI issues, simple acknowledgments.

Keep entities focused on subject-matter concepts (not meta-learning comments). Max 8 entities, 4 relationships.`

  const userPrompt = `Course: "${courseTitle}" | Current topic: "${topicTitle}" | Source: ${source}
Learner message: "${message.slice(0, 500)}"`

  try {
    const raw = await generateAI({
      feature: 'graph_interaction_analyzer',
      system: systemPrompt,
      user: userPrompt,
      responseMimeType: 'text/plain',
    })
    const parsed = parseAIJson<Partial<InteractionAnalysisResult>>(raw)

    return {
      is_update_graph: Boolean(parsed.is_update_graph),
      entities: Array.isArray(parsed.entities)
        ? (parsed.entities as ExtractedEntity[]).slice(0, 8)
        : [],
      relationships: Array.isArray(parsed.relationships)
        ? (parsed.relationships as ExtractedRelationship[]).slice(0, 4)
        : [],
      source,
    }
  } catch {
    return EMPTY_RESULT(source)
  }
}
