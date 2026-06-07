import { NextResponse } from 'next/server'

// This endpoint is superseded by the adaptive exam engine at /api/exams/*.
// All quiz evaluation now flows through:
//   POST /api/exams/start           — start or resume a session
//   POST /api/exams/[sessionId]/answer — submit an answer and advance
// Returning 410 so stale clients fail loudly instead of silently.
export async function POST() {
  return NextResponse.json(
    { error: 'This endpoint has been replaced. Use /api/exams/start and /api/exams/[sessionId]/answer instead.' },
    { status: 410 },
  )
}
