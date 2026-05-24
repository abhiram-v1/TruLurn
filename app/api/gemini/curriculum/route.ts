import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    {
      error: 'This route is deprecated. Use POST /api/courses/generate so course generation stays product-level and database-backed.',
    },
    { status: 410 }
  )
}
