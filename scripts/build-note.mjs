/*
 * Assemble docs/기술개발노트.html from its template and the screens in
 * docs/images/.
 *
 * The published note has to be ONE self-contained file — it is read from a
 * shared link where relative image paths do not resolve — so the pictures are
 * inlined as data URIs. That makes the built file impossible to hand-edit, so
 * the prose lives in the template and this puts the two together. Plain Node,
 * no dependencies: edit the template, run `npm run note`, republish.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const template = readFileSync(join(root, 'docs/note.template.html'), 'utf8')

const out = template.replace(/\{\{([\w-]+)\}\}/g, (_, name) => {
  const file = join(root, 'docs/images', `${name}.jpg`)
  try {
    return `data:image/jpeg;base64,${readFileSync(file).toString('base64')}`
  } catch {
    throw new Error(`the template asks for docs/images/${name}.jpg and it is not there`)
  }
})

const path = join(root, 'docs/기술개발노트.html')
writeFileSync(path, out)
console.log(`docs/기술개발노트.html — ${(out.length / 1024 / 1024).toFixed(2)}MB`)
