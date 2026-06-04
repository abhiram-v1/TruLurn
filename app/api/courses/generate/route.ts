import { NextResponse } from 'next/server'
import { generateAndPersistCourse } from '@/lib/course-generation/generateCourse'
import { readCourseGenerationInput, validateCourseGenerationInput } from '@/lib/course-generation/input'
import { validateTopicSuitability } from '@/lib/course-generation/topicValidator'
import { getRequiredUserId } from '@/lib/server/currentUser'

const UNSUITABLE_MESSAGE =
  'This topic is not suitable for structured course creation. Please enter a subject that can be taught through multiple lessons, such as programming, mathematics, design, business, science, languages, or other professional skills.'

export async function POST(request: Request) {
  try {
    const input = await readCourseGenerationInput(request)
    const validationError = validateCourseGenerationInput(input)

    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    // Skip AI suitability check for source-grounded mode — the uploaded content defines scope.
    if (input.mode !== 'source_grounded') {
      const suitability = await validateTopicSuitability(input.goals)
      if (!suitability.valid) {
        return NextResponse.json(
          { error: UNSUITABLE_MESSAGE, code: 'TOPIC_UNSUITABLE' },
          { status: 422 }
        )
      }
    }

    const userId = await getRequiredUserId()
    const generated = await generateAndPersistCourse({ ...input, userId })

    return NextResponse.json({
      ...generated,
      redirectTo: `/course/${generated.courseId}`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown course generation error'
    const status = message.includes('sign in') ? 401 : 500

    return NextResponse.json({ error: message }, { status })
  }
}
