import { readFileSync, writeFileSync } from 'fs'
import { parse } from 'csv-parse/sync'

const [, , inputFile, outputFile] = process.argv

const csvContent = readFileSync(inputFile, 'utf-8')

try {
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    ltrim: true,
    // Цей параметр дозволяє лапки всередині тексту, 
    // але він може спрацювати не скрізь, якщо лапки зовсім "дикі"
    relax_quotes: true, 
    relax_column_count: true,
    // Допомагає, якщо лапки стоять як у рядку 16
    quote: '"',
    escape: '"',
  })

  // Додаткова чистка: якщо парсер через помилки залишив лапки в тексті
  const sanitized = records.map((row: any) => {
    const cleanRow: any = {}
    for (const key in row) {
      let val = row[key].trim()
      // Прибираємо "сміттєві" лапки з початків і кінців значень
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.substring(1, val.length - 1)
      }
      cleanRow[key] = val
    }
    return cleanRow
  })

  const out = outputFile ?? inputFile.replace(/\.csv$/, '.json')
  writeFileSync(out, JSON.stringify(sanitized, null, 2))
  console.log(`✓ Готово! Збережено рядків: ${sanitized.length}`)

} catch (e: any) {
  console.error("❌ Не вдалося розпарсити автоматично.")
  console.error("Порада: Заміни внутрішні лапки в назвах на « » або завантаж файл у Google Sheets і експортуй як TSV.")
  console.error("Деталі помилки:", e.message)
}