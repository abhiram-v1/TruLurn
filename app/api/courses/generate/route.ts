import { NextResponse } from 'next/server'
import { generateAndPersistCourse } from '@/lib/course-generation/generateCourse'
import { readCourseGenerationInput, validateCourseGenerationInput } from '@/lib/course-generation/input'
import { getRequiredUserId } from '@/lib/server/currentUser'

export async function POST(request: Request) {
  try {
    const input = await readCourseGenerationInput(request)
    const validationError = validateCourseGenerationInput(input)

    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
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
