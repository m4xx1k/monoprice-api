type Entry = { route: string; method: string; status: number; duration: number; ts: number }

const MAX_ENTRIES = 10_000
const entries: Entry[] = []

export function record(route: string, method: string, status: number, duration: number) {
  entries.push({ route, method, status, duration, ts: Date.now() })
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES)
}

export function getSummary() {
  const byRoute = new Map<string, number[]>()

  for (const e of entries) {
    const key = `${e.method} ${e.route}`
    let arr = byRoute.get(key)
    if (!arr) {
      arr = []
      byRoute.set(key, arr)
    }
    arr.push(e.duration)
  }

  const result: Record<string, { count: number; avg: number; p50: number; p95: number; p99: number; max: number }> = {}

  for (const [key, durations] of byRoute) {
    durations.sort((a, b) => a - b)
    const len = durations.length
    result[key] = {
      count: len,
      avg: Math.round(durations.reduce((a, b) => a + b, 0) / len),
      p50: durations[Math.floor(len * 0.5)],
      p95: durations[Math.floor(len * 0.95)],
      p99: durations[Math.floor(len * 0.99)],
      max: durations[len - 1],
    }
  }

  return result
}
