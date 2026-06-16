#!/usr/bin/env node
// Validates that key infrastructure operations stay within latency budgets.
//
// Usage: node scripts/check-latency-budgets.mjs
//
// Budgets (conservative — these are minimum acceptable, not ideal):
//   DB ping (cold):         < 500 ms
//   DB ping (warm):         < 100 ms
//   DB collection read:     < 300 ms
//   5-ping median:          < 80 ms
//
// These budgets catch: unintentional production DB changes, misconfigured
// connection pools, and network-layer regressions before they reach users.

import { MongoClient } from 'mongodb'
import { performance } from 'node:perf_hooks'

const BUDGETS = {
  cold_connect_ms: 500,
  warm_ping_ms: 100,
  collection_read_ms: 300,
  median_ping_ms: 80,
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

async function checkLatencyBudgets() {
  const uri = process.env.MONGODB_URI
  if (!uri) {
    console.error('MONGODB_URI is not set. Set it in your environment before running this check.')
    process.exit(1)
  }

  console.log('Checking latency budgets...\n')

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 })
  const results = []
  let budgetViolations = 0

  try {
    // Cold connect
    const t0 = performance.now()
    await client.connect()
    const coldMs = Math.round(performance.now() - t0)

    const db = client.db()

    function check(label, actualMs, budgetMs) {
      const ok = actualMs <= budgetMs
      const icon = ok ? '✓' : '✗'
      console.log(`${icon} ${label}: ${actualMs}ms (budget: ${budgetMs}ms)`)
      results.push({ label, actualMs, budgetMs, ok })
      if (!ok) budgetViolations++
    }

    check('Cold DB connect', coldMs, BUDGETS.cold_connect_ms)

    // Warm pings
    const pingTimes = []
    for (let i = 0; i < 5; i++) {
      const t = performance.now()
      await db.command({ ping: 1 })
      pingTimes.push(Math.round(performance.now() - t))
    }

    for (let i = 0; i < pingTimes.length; i++) {
      check(`Warm ping ${i + 1}`, pingTimes[i], BUDGETS.warm_ping_ms)
    }

    const med = Math.round(median(pingTimes))
    check('Ping median (5 samples)', med, BUDGETS.median_ping_ms)

    // Collection read (topics — should always exist in a live DB)
    const t1 = performance.now()
    await db.collection('topics').findOne({}, { projection: { _id: 1 } })
    const readMs = Math.round(performance.now() - t1)
    check('Collection read (topics.findOne)', readMs, BUDGETS.collection_read_ms)

  } finally {
    await client.close()
  }

  console.log(`\n${results.length - budgetViolations}/${results.length} checks passed`)

  if (budgetViolations > 0) {
    console.error(`\n[FAIL] ${budgetViolations} latency budget(s) exceeded.`)
    console.error('This may indicate: slow network to MongoDB, connection pool exhaustion, or a misconfigured URI.')
    process.exit(1)
  } else {
    console.log('\n[PASS] All latency budgets are within acceptable range.')
  }
}

checkLatencyBudgets().catch((err) => {
  console.error('Latency check failed:', err.message)
  process.exit(1)
})
