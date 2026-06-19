import type { CurriculumSkillInput, SkillPrompt } from '@/lib/ai/skills/types'
import { buildCurriculumFidelityNote, resolveSourceFidelityPolicy } from '@/lib/course-generation/sourceFidelity'
import { formatSourceProfileForCurriculum } from '@/lib/course-generation/sourceProfile'
import { formatCompactSourceForPrompt } from '@/lib/course-generation/sourceCompaction'

export function curriculumBuilderSkill(input: CurriculumSkillInput): SkillPrompt {
  // Source fidelity is independent from teaching persona: persona controls
  // delivery, while depth, purpose, and source signals control scope.
  const fidelityNote = buildCurriculumFidelityNote(resolveSourceFidelityPolicy({
    mode: input.mode,
    courseDepth: input.courseDepth,
    learningPurpose: input.learningPurpose,
    sourceProfile: input.sourceProfile,
  }))
  const researchRule = input.curriculumResearchBrief?.trim()
    ? `Research-backed curriculum evidence:
---
${input.curriculumResearchBrief}
---

Use this evidence as calibration for the roadmap. Preserve high-consensus, domain-defining concepts and sequencing patterns. If the evidence says a concept is a missing-risk item, do not skip it unless it is clearly outside the learner's goal. Avoid generic prerequisite padding that reputable curricula do not emphasize for this subject.`
    : 'No external curriculum research brief was supplied.'

  const sourceRule =
    input.mode === 'source_grounded'
      ? `SOURCE-BASED LEARNING MODE — the uploaded sources ARE the course. This is a hard content boundary, not a style guide.

The student chose to learn exactly what their materials cover. Every topic in this curriculum must be traceable to content that actually appears in the uploaded sources. You are organizing and sequencing THEIR material — not completing the subject around it.

- ONLY create topics for concepts the uploaded material actually teaches. If the upload covers "Transactions in DBMS", the course is about transactions as taught by these sources — never a full DBMS course.
- Do NOT add topics from general subject knowledge to "fill gaps". A missing concept is out of scope, not a topic to invent.
- DETECT the internal structure of the sources and organize topics into three concept groups:
    • "prequel"  — foundational concepts the sources themselves teach or substantially explain, which later source material builds on (e.g. an intro/recap section, definitions established early).
    • "current"  — the main body of concepts the sources teach. Most topics belong here.
    • "sequel"   — next-step or advanced concepts the sources teach near the end or as extensions/outlook.
  Set concept_group on every topic. Sequence branches/sections so prequel concepts come first, current concepts form the body, and sequel concepts close the course.
- CONCEPT LINKING: when the same concept appears across multiple sources, link them — one topic, with prerequisites pointing at the topics that prepare it, even across source files. Use prerequisites/prerequisite_strength to encode how concepts in different sources relate. Continuity comes from these links, never from invented bridge content.
- Set source_anchor on every topic: a short pointer to where in the sources this topic lives (e.g. "Source 2 — section 'Locking Protocols'"). If you cannot name an anchor, the topic does not belong in this course.
- Within the source-covered material, the source order (Source 1, Source 2, Source 3) is the authoritative sequencing signal unless an explicit in-source prerequisite demands reordering; explain any reorder in structure_reasoning.
- Name topics with the instructor's own section names and terminology. Match the educational level and depth the sources evidence.
- Set source_coverage: "covered" on every topic (a topic that is not covered must not exist in this mode).
- Concepts the sources ASSUME but never teach are NOT topics. List them in out_of_scope.assumed_prerequisites (short names) so the student knows what background the material expects.
- Concepts the sources only MENTION as further/future material are NOT topics. List them in out_of_scope.mentioned_followups.
- Page counts must reflect how much source material exists for the topic — a topic with one source paragraph is "light" with 1 page, never inflated.
${fidelityNote}
- TOPIC GRANULARITY — topic count comes from the conceptual structure of the material, never from a per-document splitting habit:
    • A single cohesive document that teaches one subject arc becomes ONE topic. Its internal sections become that topic's pages (scale estimated_pages to the source volume) or Traccia children when a sub-area is independently learnable — never sibling Atlas-level topics.
    • Split a document into multiple topics ONLY when it contains genuinely distinct subject areas that a student would study and be assessed on separately. Section headings alone are NOT a reason to split — sections of one continuous teaching arc are pages, not topics.
    • Prefer fewer, richer topics over many shallow ones. One document must not mechanically become 3 topics, and 3 documents must never become 9+ — fragmentation destroys navigation and concept continuity.
    • Optimize for cohesion, learnability, navigation simplicity, and concept continuity. In structure_reasoning, justify the topic count: name the genuinely distinct subject areas that forced any split.`
      : 'Use the research-backed curriculum evidence plus general model knowledge. Be accurate and do not over-promise.'

  const sourceProfileBlock =
    input.mode === 'source_grounded' ? formatSourceProfileForCurriculum(input.sourceProfile) : ''
  const teacherDepthRule = {
    low: `Course depth: Low.
- Optimize for overview-level understanding and fast completion.
- Focus on core concepts and key intuitions only. Skip advanced nuances, edge cases, and supplementary content.
- Use the LOWER end of estimated_pages for every topic:
    light = 1 page | medium = 1–2 pages | important = 2–3 pages | critical = 3–5 pages
- Prefer broader topics with fewer subtopics over fine-grained breakdowns.`,
    standard: `Course depth: Standard.
- Balanced coverage suitable for most learners.
- Include core explanations, practical examples, and relevant context.
- Use the middle of estimated_pages ranges:
    light = 1–2 pages | medium = 2–3 pages | important = 3–5 pages | critical = 5–7 pages`,
    high: `Course depth: High.
- Comprehensive mastery-level coverage.
- Include detailed reasoning, advanced nuances, and additional examples where they provide genuine value.
- Use the UPPER end of estimated_pages ranges:
    light = 2–3 pages | medium = 3–5 pages | important = 5–7 pages | critical = 7–9 pages
- Include subtopics for advanced nuances and worked examples only when they genuinely aid mastery — no padding.`,
  }[input.courseDepth]
  const depthRule = input.mode === 'source_grounded'
    ? `Course depth: ${input.courseDepth}.
- Depth controls how deeply the uploaded material is explained, not which topics exist.
- Do not add advanced nuances, prerequisites, projects, examples, or follow-up topics unless the sources actually teach them.
- Keep all substantive source-covered concepts reachable, using richer pages instead of invented topic expansion.
- estimated_pages remains a ceiling and must be proportional to the amount of source material available.`
    : teacherDepthRule

  const teacherKnowledgeLevelRule = {
    beginner: `Student knowledge level: Beginner.
The student has no prior domain knowledge. The curriculum must be structured so that no topic assumes
anything that hasn't already been taught in a prior topic.

Curriculum rules:
- Open the roadmap with a motivational "Why does this matter?" entry topic before any technical content.
- Include explicit prerequisite topics (e.g. "What is a Function?", "What is Data?") even if they seem obvious.
- Break complex ideas into smaller sub-topics — one mental leap per topic, not three.
- Sequence topics so that intuition always precedes formalism: analogy topics before definition topics.
- Each topic title should sound like an answer to a question a curious beginner would actually ask.
- Do NOT include topics on advanced nuances, edge cases, or failure modes at this level — those come later.`,

    intermediate: `Student knowledge level: Intermediate.
The student knows core vocabulary and has seen basic examples. The curriculum should skip foundations
and focus on building real understanding.

Curriculum rules:
- Skip "What is X?" overview topics unless X is genuinely specialized or non-obvious.
- Sequence topics to reveal WHY things work, not just WHAT they are.
- Include comparison topics: "X vs Y — when to use each" adds more value than restating both.
- Surface the concepts that trip up intermediate learners: the points where intuition breaks down.
- Include at least one "Putting it together" or applied project topic per major section.
- Edge cases and failure conditions belong in the roadmap as explicit topics, not as footnotes inside lessons.`,

    expert: `Student knowledge level: Expert.
The student has solid command of fundamentals. The curriculum should skip all introductory material
and focus entirely on depth, theory, and insight.

Curriculum rules:
- Do not include any introductory, motivational, or "What is X?" topics.
- Open the roadmap with formal model topics, not conceptual overview topics.
- Include topics that standard courses skip: derivations, convergence proofs, failure modes, complexity bounds.
- Add "Research frontiers" or "Open problems" topics at the end of major sections.
- Include cross-domain transfer topics where relevant ("How does X connect to Y in a different field?").
- Each topic should surface something an intermediate learner would not yet know to ask about.`,
  }[input.knowledgeLevel ?? 'intermediate']
  const sourceKnowledgeLevelRule = {
    beginner: `Student knowledge level: Beginner.
- Organize only the concepts the sources teach.
- Put source-covered foundations before later source-covered concepts.
- Background the sources assume but do not teach belongs in out_of_scope.assumed_prerequisites, never in the roadmap.
- Do not create motivational or "What is X?" topics unless the uploaded material itself teaches them.
- Beginner support belongs inside lesson explanations and examples; it must not expand the syllabus.`,
    intermediate: `Student knowledge level: Intermediate.
- Organize only the concepts the sources teach.
- Preserve the source's vocabulary and expected level.
- Do not add comparison, project, edge-case, or foundation topics unless the uploaded material teaches them.
- Use page depth and examples to make the covered material useful without widening its scope.`,
    expert: `Student knowledge level: Expert.
- Organize only the concepts the sources teach.
- Preserve formalism, derivations, limitations, and advanced detail only where the material contains them.
- Do not add research frontiers, open problems, proofs, or cross-domain topics from general knowledge.
- Expertise changes treatment depth, never the source-defined syllabus.`,
  }[input.knowledgeLevel ?? 'intermediate']
  const knowledgeLevelRule = input.mode === 'source_grounded'
    ? sourceKnowledgeLevelRule
    : teacherKnowledgeLevelRule

  const teacherLearningPurposeRule = {
    explorer: `Learner purpose: Explorer.
The learner wants to understand how things work in principle — intuition, not implementation.

Curriculum rules:
- Sequence topics around big ideas and the "why", not around tools, APIs, or build steps.
- Favor conceptual breadth and the connections between ideas over exhaustive procedural depth.
- Skip heavy setup/tooling/environment topics unless they are genuinely necessary to grasp a concept.
- Each topic should answer a "how does this actually work / why is it like this" question.`,

    practitioner: `Learner purpose: Practitioner.
The learner wants to build real things. They care about applied skill, not theory for its own sake.

Curriculum rules:
- Sequence topics around capabilities the learner will be able to DO after each one.
- Include practical tooling, workflows, common patterns, and real-world application topics.
- Prefer "how to build / use / apply X" topics over derivations and proofs.
- Include applied project or worked-build topics at the end of major sections.
- Theory appears only in service of doing — just enough to make the practice make sense.`,

    researcher: `Learner purpose: Researcher.
The learner wants deep theoretical command — derivations, assumptions, and open questions.

Curriculum rules:
- Sequence topics around theoretical structure: definitions, models, derivations, proofs, limitations.
- Include formal foundations and the reasons behind design choices.
- Add "open problems", "current limitations", and "frontiers" topics where the field is unsettled.
- Practical application is secondary — include it only to ground a theoretical point.`,
  }[input.learningPurpose ?? 'practitioner']
  const sourceLearningPurposeRule = {
    explorer: `Learner purpose: Explorer.
- Emphasize intuition and connections inside the uploaded material.
- Do not add broader conceptual survey topics that the sources do not teach.`,
    practitioner: `Learner purpose: Practitioner.
- Emphasize applications, workflows, and decisions that the uploaded material actually contains.
- Do not invent tooling, projects, or implementation topics to make the source feel more practical.`,
    researcher: `Learner purpose: Researcher.
- Emphasize assumptions, derivations, limitations, and theoretical structure present in the uploaded material.
- Do not add proofs, open problems, or research context absent from the sources.`,
  }[input.learningPurpose ?? 'practitioner']
  const learningPurposeRule = input.mode === 'source_grounded'
    ? sourceLearningPurposeRule
    : teacherLearningPurposeRule

  const controlRule = {
    guided: `Guidance mode: Guided.
- Build a careful evidence-gated path.
- Fundamentals may be split when genuinely necessary, but do not over-expand obvious basics.
- Unlocking should assume quizzes/tasks are required before moving on.`,
    balanced: `Guidance mode: Balanced.
- Build the default TruLurn experience: solid structure with selective flexibility.
- Keep introductory/basic topics concise unless they are true prerequisites for many later concepts.
- The agent may later skip or prune ungenerated pages when the learner gives credible evidence of prior understanding.`,
    open: `Guidance mode: Open.
- Build a flexible learner-directed path.
- Compress basic/foundational topics aggressively unless the goal explicitly asks for fundamentals.
- The learner may jump topics; use the Atlas and graph to track skipped prerequisites rather than blocking progress.`,
  }[input.learningControl]

  return {
    name: 'curriculum_builder',
    system: `You are TruLurn's curriculum builder.
You produce a structured learning plan for a mastery system.
You judge only demonstrated evidence, never the learner's mind.
Return only valid JSON. No markdown. No prose outside JSON.`,
    user: `Build a curriculum.

Mode: ${input.mode}
Progression: ${input.learningControl}
Depth: ${input.courseDepth}
Knowledge level: ${input.knowledgeLevel ?? 'intermediate'}
Learner purpose: ${input.learningPurpose ?? 'practitioner'}
What the learner wants to learn:
${input.goals}

Rule:
${sourceRule}

Course depth policy:
${depthRule}

Student knowledge level policy:
${knowledgeLevelRule}

Learner purpose policy:
${learningPurposeRule}

Progression policy:
${controlRule}

${sourceProfileBlock ? `${sourceProfileBlock}\n` : ''}
Source text, if any:
---
${input.mode === 'source_grounded' && input.compactCurriculumSource
  ? `[Compacted outline representation of sources]\n${formatCompactSourceForPrompt(input.compactCurriculumSource)}`
  : (input.sourceText ?? 'No source text supplied.')}
---

${input.sourceOrderAnalysis ? `Source order analysis:
---
${input.sourceOrderAnalysis}
---
Use this analysis only to sequence concepts that the uploaded sources teach. Never reconstruct missing prerequisites or follow-up topics around the source span.` : ''}

${input.mode === 'source_grounded' ? 'External web research and general model knowledge must not widen the source-grounded curriculum. The uploaded material is the complete course scope.' : researchRule}

Return this exact JSON shape:
{
  "title": "short course name, 3-7 words",
  "complexity": "narrow|standard|deep|expert",
  "source_sequence_policy": "preserve_uploaded_source_order|conceptual_reorder_allowed",
  "structure_reasoning": "why this roadmap size and depth fits the goal",
  "branches": [
    {
      "id": "slug",
      "title": "top-level branch",
      "description": "short description",
      "state": "not_started",
      "sections": [
        {
          "title": "section title",
          "topics": [
            {
              "id": "slug",
              "title": "topic title",
              "description": "what this topic teaches",
              "prerequisites": ["topic id"],
              "prerequisite_strength": { "topic id": "hard|soft" },
              "depth": "light|medium|important|critical",
              "estimated_pages": 4,
              "node_type": "container|learning_unit|bridge|example_unit|assessment_unit",
              "importance": "core|supporting",
              "role": "foundation|mechanism|application|tool|theory",
              "spine_candidate": false,
              "spine_level": 0,
              "source_coverage": "covered (source_grounded mode only; omit in ai_teacher mode)",
              "concept_group": "prequel|current|sequel",
              "source_anchor": "Source N — section name (source_grounded mode only)",
              "children": [
                {
                  "id": "child-topic-slug",
                  "title": "child topic title",
                  "description": "specific learnable unit or sub-area",
                  "prerequisites": ["topic id"],
                  "prerequisite_strength": { "topic id": "hard|soft" },
                  "depth": "light|medium|important|critical",
                  "estimated_pages": 2,
                  "node_type": "learning_unit",
                  "importance": "core|supporting",
                  "role": "foundation|mechanism|application|tool|theory",
                  "spine_candidate": false,
                  "spine_level": 0,
                  "source_coverage": "covered (source_grounded mode only; omit in ai_teacher mode)",
                  "concept_group": "prequel|current|sequel",
                  "source_anchor": "Source N — section name (source_grounded mode only)",
                  "children": []
                }
              ],
              "initial_state": "locked"
            }
          ]
        }
      ]
    }
  ],
  "out_of_scope": {
    "assumed_prerequisites": ["background the sources expect but never teach (source_grounded mode only)"],
    "mentioned_followups": ["next steps the sources mention but never teach (source_grounded mode only)"]
  },
  "source_limitations": []
}

Rules:
- The title must be a concise course name, not the user's full request.
- Good titles: "Deep Learning from First Principles", "Machine Learning Foundations", "Practical Database Systems".
- Bad titles: long sentences, learning goals, instructions, or anything longer than 60 characters unless absolutely necessary.
- In ai_teacher mode, determine the number of branches, sections, and topics from the subject difficulty, target depth, and the full subject scope. In source_grounded mode, the size of the course is determined by what the sources cover — nothing more — and the topic count by the material's conceptual structure: a single cohesive document is ONE topic unless it teaches genuinely distinct subject areas.
- For source_grounded mode, every topic must be traceable to the uploaded material (set source_anchor). Within the source-covered span, preserve the visible order of Source 1, Source 2, Source 3 as the default study sequence; reorder only when an explicit prerequisite in the source demands it, and explain that in structure_reasoning.
- For source_grounded mode, set source_sequence_policy to "preserve_uploaded_source_order" unless the source itself clearly demands conceptual reordering.
- For source_grounded mode, set source_coverage: "covered" and concept_group ("prequel" | "current" | "sequel") on every topic, and fill out_of_scope with assumed prerequisites and mentioned follow-ups the sources do NOT teach. Omit source_coverage, concept_group, source_anchor, and out_of_scope entirely in ai_teacher mode.
- Topics should reuse the instructor's section names and terminology so the roadmap reads like the student's own material, organized.
- Use enough topics to avoid shallow coverage, but do not split tiny ideas into artificial fragments.
- A narrow practical topic may have fewer branches. A deep academic or technical topic needs more breadth and depth.
- Do not automatically give many pages to early fundamentals. Give foundational topics only the page count they need for the selected progression policy.
- Build recursive Traccia inside each section when the domain naturally has substructure. Use containers for broad areas and leaf learning_unit/bridge/example_unit nodes for teachable units.
- Keep Atlas branches high-level. Put deeper hierarchy inside Traccia children, not more branches.
- Only leaf learning units should have meaningful estimated_pages. Containers should usually use estimated_pages=0 or 1.
- Stop recursion when a node is independently learnable, practicable, assessable, or explainable.
- First topic in the first branch must be unlocked as active.
- Prerequisites must reference topic ids that appear earlier in the same recursive traversal.
- Every topic needs a depth and estimated_pages. Use light=1-2, medium=2-3, important=3-5, critical=5-8.
- For Guided, critical prerequisites may use the high end of the range.
- For Balanced, prefer the middle/lower range unless the topic is conceptually dense.
- For Open, prefer 1-2 pages for basics and let later agent requests add depth on demand.
- Do not include user mastery or progress claims. This is the fixed subject roadmap only.

PREREQUISITE DESIGN — design prerequisites as a knowledge graph, not a chain:
- A prerequisite means: the student genuinely cannot understand this topic without the prerequisite. Not just "it comes earlier in the outline."
- Topics in the same section that cover parallel aspects of the same domain should share a common prerequisite — they should NOT depend on each other. Chaining siblings (A→B→C where A, B, C are peers) creates a false linear dependency.
- A foundational topic (e.g. Variables, Functions, Core Syntax) should appear as a prerequisite for many topics. This is correct — it creates a fan-out in the graph.
- An integration topic (e.g. Building a Full Project, Capstone) should list several prerequisites because it genuinely requires multiple prior threads. This is correct — it creates a fan-in.
- Ask yourself: "If a student already knows X, can they learn this topic without also knowing Y?" If yes, Y is not a prerequisite of this topic, even if Y comes earlier in your outline.
- The resulting prerequisite structure should look like a DAG with 2-4 conceptual layers, not a linked list.

GRAPH TAGS — set these on every topic so the knowledge graph can render meaning, not just boxes:
- prerequisite_strength: a map from each prerequisite id (must be one of this topic's "prerequisites") to "hard" or "soft".
  • "hard" = the topic is genuinely not learnable without it (e.g. Linear Algebra → Neural Networks). Cannot be skipped.
  • "soft" = it helps but the topic can be approached without it (e.g. Probability → Neural Networks). Default to "soft" when unsure.
- importance: "core" for load-bearing concepts the course is built around; "supporting" for helpful but secondary detail. Most topics are "supporting"; reserve "core" for the genuinely central ones.
- role: the conceptual role of the topic — one of:
  • "foundation" — a base concept many things build on (Linear Algebra, Data Representations)
  • "mechanism" — a process/algorithm that powers other topics (Gradient Descent, Backpropagation)
  • "application" — applying concepts to a problem (Image Classification, Sentiment Analysis)
  • "tool" — a concrete tool/library/technique (PyTorch, Regularisation)
  • "theory" — formal/theoretical underpinning (PAC Learning, Bias-Variance)
- spine_candidate: true if this concept BECOMES foundational later — it starts inside a branch but ends up supporting topics across MULTIPLE branches or unlocking a later layer (e.g. Gradient Descent supports Linear Regression, Logistic Regression, and Neural Networks). Otherwise false.
- spine_level: 0 for original foundations with no in-course prerequisites; 1+ for derived spines that are earned after earlier layers. Use 0 if unsure and spine_candidate is false.`,
  }
}
