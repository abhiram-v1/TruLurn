import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    {
      error: 'This route is deprecated. Use POST /api/courses/generate for database-backed course creation.',
    },
    { status: 410 }
  )
}
