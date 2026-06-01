export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { GraphClient } from '@/components/graph/GraphClient'

export default async function GraphPage({
  params,
}: {
  params: { courseId: string }
}) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    redirect('/auth/signin')
  }

  return <GraphClient courseId={params.courseId} />
}