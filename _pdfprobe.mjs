/* 临时探针：读出样例 PDF 每页文本，判断哪一页是快递面单（用完即删） */
import fs from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

const files = ['huihan-0813.pdf', 'bank-qishang-20240331.pdf', 'wanglai-1-SJ01YF001.pdf']

for (const f of files) {
  const data = new Uint8Array(fs.readFileSync(`public/samples/${f}`))
  const doc = await pdfjs.getDocument({ data }).promise
  console.log(`== ${f}  pages=${doc.numPages}`)
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const text = await page.getTextContent()
    const joined = text.items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim()
    console.log(`  p${i} [items=${text.items.length}] :: ${joined.slice(0, 100)}`)
  }
}
