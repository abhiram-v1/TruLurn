import type { SkillPrompt } from '@/lib/ai/skills/types'

const SPEC_REFERENCE = `
CHART SPEC FORMAT — output a single \`\`\`chart fence containing valid JSON:

\`\`\`chart
{
  "type": "data-chart",
  "chartType": "<type>",
  "title": "<concise descriptive title>",
  "description": "<optional one-sentence context>",
  "data": [
    { "<xKey>": "<value>", "<seriesKey>": <number> }
  ],
  "xAxis": { "key": "<xKey>", "label": "<Axis label>" },
  "yAxis": { "label": "<Axis label>" },
  "series": [
    { "key": "<seriesKey>", "label": "<Series name>", "color": "<#hex optional>" }
  ],
  "config": {
    "height": 300,
    "showLegend": true,
    "showGrid": true
  }
}
\`\`\`

CHART TYPES:
• bar        — compare discrete categories side by side; also used for histograms
• line       — show trends over a continuous or ordered sequence
• area       — like line but emphasises cumulative magnitude; supports stacking via stackId
• scatter    — correlation between two numeric variables (xAxis.key and series[0].key must be numeric)
• pie        — proportional composition; use at most 6 slices; data items need "name" and "value" keys
• histogram  — frequency distribution using pre-binned data; same format as bar

PIE FORMAT (different from other types — no series/xAxis/yAxis needed):
\`\`\`chart
{
  "type": "data-chart",
  "chartType": "pie",
  "title": "...",
  "data": [
    { "name": "Category A", "value": 45 },
    { "name": "Category B", "value": 30 },
    { "name": "Category C", "value": 25 }
  ],
  "config": { "height": 300, "showLegend": true }
}
\`\`\`

STACKED AREA / BAR — add the same "stackId" to each series that should stack:
{ "key": "apples", "label": "Apples", "stackId": "fruit" },
{ "key": "oranges", "label": "Oranges", "stackId": "fruit" }

VALIDATION RULES:
- "data" must be a non-empty array; maximum 200 rows
- "xAxis.key" must be a key that exists in every data row (for non-pie charts)
- Each "series[n].key" must be a key that exists in every data row
- Maximum 8 series per chart
- config.height is clamped to 80–500; default is 300
- Colors: use hex codes; palette: #4F7DF5 #E07B56 #10B981 #8B5CF6 #F59E0B #EC4899 #06B6D4
`

export const COMPACT_CHART_OUTPUT_CONTRACT = `
CHART OUTPUT CONTRACT:
- When a chart is educationally necessary, embed a \`\`\`chart fence containing JSON.
- Required shape for bar, line, area, scatter, or histogram:
  {"type":"data-chart","chartType":"line","title":"...","description":"...","data":[{"x":1,"y":2}],"xAxis":{"key":"x","label":"..."},"yAxis":{"label":"..."},"series":[{"key":"y","label":"..."}]}
- Pie charts use data rows shaped as {"name":"...","value":number} and do not need axes or series.
- Supported chartType values: bar, line, area, scatter, pie, histogram.
- Use no more than 200 rows or 8 series. Label illustrative data honestly and never invent measurements.
- Apply subject-specific visual conventions only from COURSE SKILL CONTEXT.
`.trim()

export function dataChartSkill(context: {
  description: string
  dataHint?: string
  topicContext?: string
}): SkillPrompt {
  return {
    name: 'data_chart',
    system: `You are a data visualisation specialist for TruLurn, an AI learning platform.
Your task is to generate one chart specification that will render inside a lesson or explanation.
The chart must serve a clear educational purpose — illustrating a pattern, comparison, distribution, or relationship that would take more words to explain than the chart takes space.
Output only the chart spec in the required format. Do not add explanation outside the code fence.

${SPEC_REFERENCE}`,
    user: `Generate a chart for the following:

${context.description}${context.dataHint ? `\n\nData context / known values:\n${context.dataHint}` : ''}${context.topicContext ? `\n\nLesson topic context:\n${context.topicContext}` : ''}

Choose the most appropriate chart type. If you need to create example or illustrative data, make it realistic, clearly labelled, and educationally accurate.
Output a single chart spec in the \`\`\`chart format defined above.`,
  }
}

export const VISUAL_REPRESENTATION_PLANNING_RULES = `
VISUAL REPRESENTATION PLANNING:
- Explicitly choose "data chart" in representation_plan when quantitative shape is part of the understanding: a trend, distribution, comparison, correlation, tradeoff, growth rate, or changing quantity.
- Prefer a chart over a table when the learner must see a pattern. Prefer a table when exact lookup values matter more than shape.
- Apply any relevant visual conventions supplied by the active course skill context.
- Do not request a chart for purely verbal structure, decorative variety, or data that cannot be supported or honestly labeled as illustrative.
`.trim()

/**
 * The chart embedding instructions injected into lesson generation prompts.
 * Include this string in the system prompt wherever lesson content is generated.
 */
export const CHART_EMBEDDING_INSTRUCTIONS = `
CHARTS & DATA VISUALIZATIONS — embed when a visual communicates more clearly than prose:
Use a \`\`\`chart fence whenever the concept involves distributions, trends, comparisons,
or correlations that prose alone handles poorly. One well-chosen chart beats several paragraphs
of numbers. Only include a chart if it genuinely adds understanding — do not decorate.

${SPEC_REFERENCE}

WHEN TO USE EACH TYPE:
• Use bar/histogram for: comparing category values, showing frequency distributions, before/after comparisons
• Use line for: change over time, ordered progression, or comparison across a numeric sequence
• Use area for: cumulative quantities, overlapping proportions, showing magnitude alongside trend
• Use scatter for: relationships between two numeric variables, clusters, and outliers
• Use pie for: proportional composition (max 6 slices; never for trends)
• Use histogram (bar) for: frequency distributions and numeric spread

COURSE-SPECIFIC USE:
- Follow the active course skill context for subject-specific visual conventions, required explanations,
  valid assumptions, and preferred representations. The shared chart system must not invent domain rules.

DATA HONESTY:
- Never invent measurements, benchmark timings, experiment results, or source-derived values.
- If values are pedagogical examples, say "Illustrative" in the title or description.
- If exact values matter more than visual shape, use a Markdown table instead.
- For source-grounded claims, establish and cite the evidence in the surrounding prose; the chart
  should visualize that supported evidence rather than introduce uncited facts.

PLACEMENT: Place charts after the prose that sets up what to look for — never open a page with one.
LIMIT: At most one chart per page section. Multiple charts on one page rarely help; one clear chart always does.
`
