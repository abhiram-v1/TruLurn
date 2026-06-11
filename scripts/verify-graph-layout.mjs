import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptsDir, '..')
const layoutPath = path.join(projectRoot, 'lib', 'graph', 'layout.ts')
const source = fs.readFileSync(layoutPath, 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
  fileName: layoutPath,
})

const module = { exports: {} }
const loadLayout = new Function('exports', 'module', 'require', compiled.outputText)
loadLayout(module.exports, module, () => {
  throw new Error('The layout verifier only supports type-only imports.')
})

const { computeLayout } = module.exports
const transformPath = path.join(projectRoot, 'lib', 'graph', 'transform.ts')
const transformSource = fs.readFileSync(transformPath, 'utf8')
const transformCompiled = ts.transpileModule(transformSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
  fileName: transformPath,
})
const transformModule = { exports: {} }
const loadTransform = new Function('exports', 'module', 'require', transformCompiled.outputText)
loadTransform(transformModule.exports, transformModule, (request) => {
  if (request === './layout') return module.exports
  throw new Error(`Unsupported verifier import: ${request}`)
})
const { normalizeGraphTopicHierarchy } = transformModule.exports

function overlaps(a, b, padding = 0) {
  return (
    a.x + padding < b.x + b.w
    && a.x + a.w > b.x + padding
    && a.y + padding < b.y + b.h
    && a.y + a.h > b.y + padding
  )
}

function makeDenseFixture() {
  const branchTitles = new Map([
    ['foundations', 'Foundations'],
    ['supervised', 'Supervised Learning'],
    ['unsupervised', 'Unsupervised Learning'],
    ['systems', 'ML Systems'],
  ])
  const nodes = []
  const leaves = []
  const edges = []

  for (const [branchIndex, branchId] of [...branchTitles.keys()].entries()) {
    for (let groupIndex = 0; groupIndex < 3; groupIndex++) {
      const containerId = `${branchId}-group-${groupIndex}`
      nodes.push({
        id: containerId,
        branch_id: branchId,
        parent_id: null,
        node_type: 'container',
        children_count: 4,
        depth_level: 0,
        sequence_index: groupIndex * 16 + branchIndex,
        position: groupIndex,
        importance: 2,
        title: `${branchId} group ${groupIndex}`,
        section: `Section ${groupIndex}`,
      })

      for (let itemIndex = 0; itemIndex < 4; itemIndex++) {
        const id = `${containerId}-item-${itemIndex}`
        const leaf = {
          id,
          branch_id: branchId,
          parent_id: containerId,
          node_type: 'learning_unit',
          children_count: 0,
          depth_level: 1,
          sequence_index: groupIndex * 16 + itemIndex * 4 + branchIndex,
          position: itemIndex,
          importance: itemIndex === 0 ? 3 : itemIndex === 1 ? 2 : 1,
          title: `${branchId} concept ${groupIndex}.${itemIndex}`,
          section: `Section ${groupIndex}`,
        }
        nodes.push(leaf)
        leaves.push(leaf)
        if (itemIndex > 0) {
          edges.push({
            from: `${containerId}-item-${itemIndex - 1}`,
            to: id,
            edgeType: 'prerequisite',
            prereqStrength: 'hard',
          })
        }
      }
    }
  }

  edges.push(
    {
      from: 'foundations-group-0-item-3',
      to: 'supervised-group-0-item-0',
      edgeType: 'prerequisite',
      prereqStrength: 'hard',
    },
    {
      from: 'foundations-group-1-item-3',
      to: 'unsupervised-group-0-item-0',
      edgeType: 'prerequisite',
      prereqStrength: 'hard',
    },
    {
      from: 'supervised-group-2-item-3',
      to: 'systems-group-1-item-0',
      edgeType: 'prerequisite',
      prereqStrength: 'hard',
    },
  )

  return { branchTitles, nodes, leaves, edges }
}

function verifyDenseLayout() {
  const fixture = makeDenseFixture()
  const result = computeLayout(fixture.nodes, fixture.branchTitles, fixture.edges)
  const structuralIds = new Set(
    fixture.nodes.filter((node) => node.node_type === 'container').map((node) => node.id),
  )

  assert.equal(result.positions.size, fixture.leaves.length)
  for (const id of structuralIds) {
    assert.equal(result.positions.has(id), false, `container ${id} rendered as a card`)
  }

  const positioned = fixture.leaves.map((leaf) => ({
    id: leaf.id,
    ...result.positions.get(leaf.id),
  }))
  for (let i = 0; i < positioned.length; i++) {
    for (let j = i + 1; j < positioned.length; j++) {
      assert.equal(
        overlaps(positioned[i], positioned[j]),
        false,
        `cards overlap: ${positioned[i].id} and ${positioned[j].id}`,
      )
    }
  }

  for (const edge of fixture.edges) {
    const from = result.positions.get(edge.from)
    const to = result.positions.get(edge.to)
    assert.ok(from && to)
    assert.ok(to.x > from.x, `hard prerequisite does not advance: ${edge.from} -> ${edge.to}`)
  }

  const groupBoxes = result.boxes
  assert.equal(groupBoxes.length, fixture.branchTitles.size, 'expected one group per branch')
  assert.equal(new Set(groupBoxes.map((box) => box.family)).size, groupBoxes.length)

  for (const leaf of fixture.leaves) {
    const position = result.positions.get(leaf.id)
    const group = groupBoxes.find((box) => box.family === leaf.branch_id)
    assert.ok(position && group)
    assert.equal(position.boxId, group.id)
    assert.ok(position.x >= group.x + (group.padding ?? 0), `${leaf.id} misses left padding`)
    assert.ok(position.x + position.w <= group.x + group.w - (group.padding ?? 0), `${leaf.id} misses right padding`)
    assert.ok(position.y >= group.y + 42, `${leaf.id} overlaps the group header`)
    assert.ok(position.y + position.h <= group.y + group.h - 24, `${leaf.id} misses bottom padding`)
  }

  for (const group of groupBoxes) {
    const branchPositions = fixture.leaves
      .filter((leaf) => leaf.branch_id === group.family)
      .map((leaf) => result.positions.get(leaf.id))
      .filter(Boolean)
    const minX = Math.min(...branchPositions.map((position) => position.x))
    const minY = Math.min(...branchPositions.map((position) => position.y))
    const maxX = Math.max(...branchPositions.map((position) => position.x + position.w))
    const maxY = Math.max(...branchPositions.map((position) => position.y + position.h))

    assert.equal(group.x, minX - group.padding)
    assert.equal(group.y, minY - 42)
    assert.equal(group.w, maxX - minX + group.padding * 2)
    assert.equal(group.h, maxY - group.y + 24)
  }

  for (let i = 0; i < groupBoxes.length; i++) {
    for (let j = i + 1; j < groupBoxes.length; j++) {
      assert.equal(
        overlaps(groupBoxes[i], groupBoxes[j]),
        false,
        `branch groups overlap: ${groupBoxes[i].id} and ${groupBoxes[j].id}`,
      )
    }
  }

  assert.ok(result.canvasW / result.canvasH >= 2, 'dense fixture is not predominantly horizontal')
  assert.ok(result.canvasH <= 1500, `dense fixture is too tall: ${result.canvasH}px`)

  return {
    cards: positioned.length,
    groups: groupBoxes.length,
    canvas: `${result.canvasW}x${result.canvasH}`,
    ratio: (result.canvasW / result.canvasH).toFixed(2),
  }
}

function verifySectionFallback() {
  const nodes = ['Intro', 'Practice', 'Review'].map((title, index) => ({
    id: `solo-${index}`,
    branch_id: 'solo',
    parent_id: null,
    node_type: 'learning_unit',
    children_count: 0,
    depth_level: 0,
    sequence_index: index,
    position: index,
    importance: 2,
    title,
    section: 'Core ideas',
  }))
  const result = computeLayout(nodes, new Map([['solo', 'Solo Course']]), [])
  const group = result.boxes[0]

  assert.ok(group)
  assert.equal(group.label, 'Solo Course')
  assert.equal(group.nodeCount, nodes.length)
  for (const node of nodes) {
    assert.equal(result.positions.get(node.id)?.boxId, group.id)
  }
}

function verifyLegacyHierarchyRepair() {
  const topics = normalizeGraphTopicHierarchy([
    {
      _id: 'group',
      course_id: 'course',
      branch_id: 'branch',
      section: 'Core',
      title: 'Legacy group',
      position: 0,
      state: 'locked',
      created_at: new Date(),
    },
    {
      _id: 'leaf',
      course_id: 'course',
      branch_id: 'branch',
      section: 'Core',
      title: 'Legacy leaf',
      position: 1,
      path_ids: ['group', 'leaf'],
      state: 'active',
      created_at: new Date(),
    },
  ])
  const group = topics.find((topic) => topic._id === 'group')
  const leaf = topics.find((topic) => topic._id === 'leaf')

  assert.equal(group?.node_type, 'container')
  assert.equal(group?.children_count, 1)
  assert.equal(leaf?.parent_id, 'group')
  assert.equal(leaf?.node_type, 'learning_unit')
  assert.equal(leaf?.sequence_index, 1)
}

const summary = verifyDenseLayout()
verifySectionFallback()
verifyLegacyHierarchyRepair()
console.log(
  `Graph layout verified: ${summary.cards} cards in ${summary.groups} adaptive branch groups, `
  + `canvas ${summary.canvas} (${summary.ratio}:1).`,
)
