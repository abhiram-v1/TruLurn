import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function getRequiredUserId() {
  const session = await getServerSession(authOptions)
  const userId = session?.user ? (session.user as typeof session.user & { id?: string }).id : null

  if (!userId) {
    throw new Error('You must sign in before creating a persistent course.')
  }

  return userId
}
