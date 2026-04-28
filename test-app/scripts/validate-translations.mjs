#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const localesDir = path.resolve(__dirname, '../src/locales')
const enPath = path.join(localesDir, 'i18n-en.json')
const langs = ['es', 'fr', 'zh']

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function placeholders(text) {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
}

function htmlTags(text) {
  return [...text.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g)]
    .map((match) => match[1].toLowerCase())
    .sort()
}

function assertEqualArrays(a, b, label) {
  const left = JSON.stringify(a)
  const right = JSON.stringify(b)
  if (left !== right) {
    throw new Error(`${label}: expected ${right}, got ${left}`)
  }
}

const enData = readJson(enPath)
const enKeys = Object.keys(enData)

for (const lang of langs) {
  const filePath = path.join(localesDir, `i18n-${lang}.json`)
  const data = readJson(filePath)
  const keys = Object.keys(data)
  assertEqualArrays(keys, enKeys, `Key mismatch in i18n-${lang}.json`)

  for (const key of enKeys) {
    const source = String(enData[key])
    const target = String(data[key])
    assertEqualArrays(
      placeholders(target),
      placeholders(source),
      `${lang}.${key} placeholder mismatch`,
    )
    assertEqualArrays(
      htmlTags(target),
      htmlTags(source),
      `${lang}.${key} HTML tag mismatch`,
    )
  }
}

process.stdout.write('Translation validation passed for es/fr/zh.\n')
