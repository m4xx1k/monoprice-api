import { readFileSync, writeFileSync } from 'fs'
import { parse } from 'csv-parse/sync'

const [, , inputFile, outputFile] = process.argv

if (!inputFile) {
  console.error('Usage: tsx scripts/csv-to-json.ts <input.csv> [output.json]')
  process.exit(1)
}

const csv = readFileSync(inputFile, 'utf-8')
const records = parse(csv, { columns: true, skip_empty_lines: true })

const out = outputFile ?? inputFile.replace(/\.csv$/, '.json')
writeFileSync(out, JSON.stringify(records, null, 2))
console.log(`✓ ${records.length} records → ${out}`)
