import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    {
      error: 'Source-based curricula are temporarily unavailable during the beta.',
      code: 'SOURCE_CURRICULA_DISABLED',
    },
    { status: 410 },
  )
}
