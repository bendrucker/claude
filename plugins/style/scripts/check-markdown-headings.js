#!/usr/bin/env node

import { fromMarkdown } from 'mdast-util-from-markdown'
import { visit } from 'unist-util-visit'

const content = process.argv[2] || ''
const ast = fromMarkdown(content)
const matches = []

visit(ast, 'heading', (node) => {
  // Extract text content from heading children
  const text = node.children
    .filter(child => child.type === 'text')
    .map(child => child.value)
    .join('')

  // Check for numbered patterns
  if (/^[0-9]+\.\s/.test(text) || /^(Step|Phase|Part)\s+[0-9]+/i.test(text)) {
    matches.push({
      text: text.trim(),
      line: node.position?.start?.line || 0,
      column: node.position?.start?.column || 0
    })
  }
})

if (matches.length > 0) {
  console.log(JSON.stringify(matches))
}
