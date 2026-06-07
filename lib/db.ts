import { MongoClient } from 'mongodb'
import { ensureIndexes } from '@/lib/db-indexes'

if (!process.env.MONGODB_URI) {
  throw new Error('Invalid/Missing environment variable: "MONGODB_URI"')
}

const uri = process.env.MONGODB_URI
const options = {}

let client: MongoClient
let clientPromise: Promise<MongoClient>

if (process.env.NODE_ENV === 'development') {
  // In development mode, use a global variable so that the value
  // is preserved across module reloads caused by HMR (Hot Module Replacement).
  const globalWithMongo = global as typeof globalThis & {
    _mongoClientPromise?: Promise<MongoClient>
  }

  if (!globalWithMongo._mongoClientPromise) {
    client = new MongoClient(uri, options)
    globalWithMongo._mongoClientPromise = client.connect()
  }
  clientPromise = globalWithMongo._mongoClientPromise
} else {
  // In production mode, it's best to not use a global variable.
  client = new MongoClient(uri, options)
  clientPromise = client.connect()
}

export default clientPromise

let _indexesInitiated = false

export async function getDb(dbName = 'trulurn') {
  const client = await clientPromise
  const db = client.db(dbName)
  if (!_indexesInitiated) {
    _indexesInitiated = true
    ensureIndexes(db).catch((err) => console.warn('[db] Index initialization failed:', err))
  }
  return db
}
