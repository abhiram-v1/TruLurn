'use client'

import { useMemo } from 'react'
import { parseTruViz } from '@/lib/trueviz/parser'
import { NeuralNet } from './NeuralNet'
import { DataChart } from './DataChart'
import { CoordinateVectors } from './CoordinateVectors'

/**
 * Entry point for TruViz diagrams.
 * Receives the raw JSON content of a ```trueviz fence block,
 * parses it, and routes to the correct renderer.
 *
 * Usage in Markdown:
 *   ```trueviz
 *   {
 *     "type": "neural-net",
 *     "title": "3-4-2 Feedforward Network",
 *     "layers": [
 *       { "size": 3, "label": "Input" },
 *       { "size": 4, "label": "Hidden", "activation": "ReLU" },
 *       { "size": 2, "label": "Output", "activation": "Softmax" }
 *     ]
 *   }
 *   ```
 */
export function TruViz({ raw }: { raw: string }) {
  const result = useMemo(() => parseTruViz(raw), [raw])

  if (!result.ok) {
    return (
      <div className="trueviz-error">
        <span className="trueviz-error-label">TruViz</span>
        {result.error}
      </div>
    )
  }

  const { spec } = result

  if (spec.type === 'neural-net') {
    return <NeuralNet spec={spec} />
  }

  if (spec.type === 'data-chart') {
    return <DataChart spec={spec} />
  }

  if (spec.type === 'coordinate-vectors') {
    return <CoordinateVectors spec={spec} />
  }

  return (
    <div className="trueviz-error">
      <span className="trueviz-error-label">TruViz</span>
      Renderer for type &ldquo;{(spec as { type: string }).type}&rdquo; is not yet implemented.
    </div>
  )
}
