export const COMPACT_VECTOR_OUTPUT_CONTRACT = `
COORDINATE VECTOR DIAGRAM CONTRACT:
- For vectors, points, bases, coordinate transformations, projections, or geometric relationships in 2D/3D, use a \`\`\`trueviz JSON fence with type "coordinate-vectors". Never draw coordinate diagrams with ASCII inside a text/code fence.
- 2D example:
  \`\`\`trueviz
  {"type":"coordinate-vectors","dimensions":2,"title":"Vector v = (3, 4)","description":"The tail is at the origin and the head is at (3, 4).","vectors":[{"from":[0,0],"to":[3,4],"label":"v","emphasis":"primary"}],"points":[{"at":[3,4],"label":"head"}],"axisLabels":["x","y"],"showGrid":true,"showCoordinates":true}
  \`\`\`
- 3D uses dimensions:3 and three-coordinate tuples, for example "to":[2,1,3].
- For addition, draw u from the origin, v from u's head, and u + v from the origin. Use dashed or muted vectors for construction lines.
- Keep labels short, use at most 12 vectors and 16 points, and explain in the surrounding prose exactly what the learner should inspect.
`.trim()

export const VECTOR_DIAGRAM_EMBEDDING_INSTRUCTIONS = `
VECTOR & COORDINATE DIAGRAMS:
- A spatial vector explanation should be spatial. When teaching a concrete vector, direction, magnitude, components, addition, subtraction, span, basis, projection, transformation, plane, or 3D coordinate relationship, embed a coordinate-vectors diagram when seeing the geometry adds intuition.
- If the prose says "sketch", "plot", "picture", "visualize", "tail", "head", "coordinate plane", or asks the learner to imagine an arrow, render the diagram. Do not substitute ASCII art or a fenced text sketch.
- Place the diagram immediately after the sentence that tells the learner what to inspect. Reference its labels in the explanation after it.
- Use 2D unless the z-coordinate or genuinely three-dimensional structure matters. Do not use a statistical data chart to represent a Cartesian vector.

${COMPACT_VECTOR_OUTPUT_CONTRACT}
`

export const VECTOR_REPRESENTATION_PLANNING_RULES = `
- Explicitly choose "coordinate vector diagram" in representation_plan when spatial position, direction, components, vector operations, bases, projections, transformations, or 2D/3D geometry are part of the target understanding.
- Never choose "diagram description" when the coordinate-vectors renderer can show the relationship directly.
`.trim()
