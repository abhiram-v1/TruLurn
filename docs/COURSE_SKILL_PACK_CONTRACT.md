# Course Skill Pack Contract

Course-specific teaching knowledge belongs in versioned skill packs, not in the shared generator.

## Attach a pack

Store its key on a course:

```json
{
  "course_skill_keys": ["subject-pack-key"]
}
```

## Store a pack

Use the `courseSkillPacks` collection:

```json
{
  "key": "subject-pack-key",
  "version": 1,
  "title": "Subject Pack",
  "status": "active",
  "retrieval_terms": ["optional", "routing", "terms"],
  "instructions": {
    "shared": "Rules used on every surface.",
    "planning": "How to plan this subject.",
    "lesson": "How to teach and visualize this subject.",
    "agent": "How to answer subject questions.",
    "quiz": "How to assess this subject.",
    "recall": "How to construct recall cues."
  },
  "documents": [
    {
      "id": "stable-document-id",
      "title": "Specific concept or convention",
      "tags": ["retrieval", "keywords"],
      "content": "Trusted reference content and instructions."
    }
  ]
}
```

Increment `version` whenever instructions or documents change. Cached topic plans are automatically invalidated when the attached pack version changes.

The shared runtime retrieves only attached packs, injects surface-specific instructions, ranks documents against the current topic or question, and enforces a bounded context size.
