import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as os from 'node:os'
import { parseYamlFrontmatter, parseYamlFrontmatterFromString } from './parser.js'

function makeTmpDir(): string {
  const dir = join(
    os.tmpdir(),
    `wm-parser-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('parseYamlFrontmatter', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = makeTmpDir()
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('parses valid YAML frontmatter from a file', () => {
    const filePath = join(tmpDir, 'test.md')
    writeFileSync(
      filePath,
      `---
title: "My Document"
version: 3
tags:
  - alpha
  - beta
---

# Body content here
`,
    )

    const result = parseYamlFrontmatter<{ title: string; version: number; tags: string[] }>(
      filePath,
    )
    expect(result).not.toBeNull()
    expect(result!.title).toBe('My Document')
    expect(result!.version).toBe(3)
    expect(result!.tags).toEqual(['alpha', 'beta'])
  })

  it('returns null when file has no frontmatter', () => {
    const filePath = join(tmpDir, 'no-frontmatter.md')
    writeFileSync(filePath, '# Just a markdown file\n\nNo frontmatter here.\n')

    const result = parseYamlFrontmatter(filePath)
    expect(result).toBeNull()
  })

  it('returns null when frontmatter is malformed YAML', () => {
    const filePath = join(tmpDir, 'bad.md')
    writeFileSync(
      filePath,
      `---
title: [invalid yaml: {{{
---

Body
`,
    )

    const result = parseYamlFrontmatter(filePath)
    expect(result).toBeNull()
  })

  it('returns null when file does not exist', () => {
    const result = parseYamlFrontmatter(join(tmpDir, 'nonexistent.md'))
    expect(result).toBeNull()
  })

  it('returns null when frontmatter delimiters are missing closing ---', () => {
    const filePath = join(tmpDir, 'unclosed.md')
    writeFileSync(filePath, '---\ntitle: "unclosed"\nBody content\n')

    const result = parseYamlFrontmatter(filePath)
    expect(result).toBeNull()
  })
})

describe('parseYamlFrontmatterFromString', () => {
  it('parses valid YAML frontmatter from a string', () => {
    const content = `---
id: setup
name: "Project Setup"
phases:
  - id: p1
    name: "Phase 1"
---

# Markdown body
`
    const result = parseYamlFrontmatterFromString<{
      id: string
      name: string
      phases: Array<{ id: string; name: string }>
    }>(content)
    expect(result).not.toBeNull()
    expect(result!.id).toBe('setup')
    expect(result!.name).toBe('Project Setup')
    expect(result!.phases).toHaveLength(1)
    expect(result!.phases[0].id).toBe('p1')
  })

  it('returns null for invalid YAML in string', () => {
    const content = `---
bad: [yaml: {{{
---
body
`
    const result = parseYamlFrontmatterFromString(content)
    expect(result).toBeNull()
  })

  it('returns null for string with no frontmatter', () => {
    const result = parseYamlFrontmatterFromString('Just some text, no frontmatter')
    expect(result).toBeNull()
  })

  it('returns null for empty string', () => {
    const result = parseYamlFrontmatterFromString('')
    expect(result).toBeNull()
  })
})
