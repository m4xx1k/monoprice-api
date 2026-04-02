/**
 * Cleans up already-scraped JSON files — strips CSS-in-JS noise from title and description fields.
 *
 * Usage:  npx tsx tests/fix-descriptions.ts <input_name>
 *   e.g.: npx tsx tests/fix-descriptions.ts olx-products
 *
 * Overwrites the file in-place (backs up the original as <name>.bak.json).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

function hasCssNoise(s: string): boolean {
  return s.includes('{') || /\.css-[a-zA-Z0-9]+/.test(s)
}

function stripCss(s: string): string {
  // Remove .css-XXXXX{...} blocks (multiline)
  let out = s.replace(/\.css-[a-zA-Z0-9]+\s*\{[\s\S]*?\}/g, '')
  // Remove any remaining bare {...} blocks (leftover selectors)
  out = out.replace(/\{[\s\S]*?\}/g, '')
  return out
}

function cleanTitle(raw: string): string {
  if (!hasCssNoise(raw)) return raw
  const stripped = stripCss(raw)
  // Title is single-line — take the first non-empty line that's not a CSS artifact
  const line = stripped
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !hasCssNoise(l))
  return line ?? stripped.trim()
}

function cleanDescription(raw: string): string {
  if (!hasCssNoise(raw) && !raw.startsWith('Опис')) return raw
  let cleaned = stripCss(raw)
  // Remove "Опис" heading OLX injects before the text
  cleaned = cleaned.replace(/^Опис\s*/u, '')
  // Collapse multiple blank lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim()
  return cleaned
}

const inputName = process.argv[2]
if (!inputName) {
  console.error('Usage: npx tsx tests/fix-descriptions.ts <input_name>')
  process.exit(1)
}

// Accept: bare name "kolesa", name with ext "kolesa.json", or any path
const filePath = inputName.includes('/')
  ? resolve(inputName)
  : resolve(import.meta.dirname!, 'data', inputName.replace(/\.json$/, '') + '.json')
const raw = readFileSync(filePath, 'utf-8')
const products = JSON.parse(raw)

// Backup
writeFileSync(filePath.replace('.json', '.bak.json'), raw, 'utf-8')

let fixedTitles = 0
let fixedDescriptions = 0

for (const p of products) {
  if (p.title) {
    const cleaned = cleanTitle(p.title)
    if (cleaned !== p.title) { p.title = cleaned; fixedTitles++ }
  }
  if (p.description) {
    const cleaned = cleanDescription(p.description)
    if (cleaned !== p.description) { p.description = cleaned; fixedDescriptions++ }
  }
}

writeFileSync(filePath, JSON.stringify(products, null, 2), 'utf-8')
console.log(`Fixed ${fixedTitles} titles, ${fixedDescriptions} descriptions (of ${products.length}). Backup → ${inputName}.bak.json`)
