import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const README_PATH = join(import.meta.dir, '..', 'README.md')
const readme = readFileSync(README_PATH, 'utf-8')

describe('README structure (VP1: TOC completeness)', () => {
  const requiredSections = [
    'What kata does',
    'Install',
    'Quick start',
    'Built-in modes',
    'How it works',
    'Stop conditions',
    'Command reference',
    'Hooks reference',
    'Configuration (kata.yaml)',
    'Custom modes',
    'Batteries system',
    'Architecture',
    'Comparison to similar tools',
    'License',
  ]

  for (const section of requiredSections) {
    it(`has section: ${section}`, () => {
      expect(readme).toContain(`## ${section}`)
    })
  }
})

describe('README mermaid diagrams (VP2: diagrams render)', () => {
  it('has mode lifecycle flowchart', () => {
    expect(readme).toContain('flowchart TD')
  })

  it('has planning→implementation flowchart', () => {
    expect(readme).toContain('flowchart LR')
  })

  it('has hook chain sequence diagram', () => {
    expect(readme).toContain('sequenceDiagram')
  })

  it('all mermaid blocks are closed', () => {
    const opens = (readme.match(/```mermaid/g) ?? []).length
    const closes = (readme.match(/^```$/gm) ?? []).length
    // At least as many closes as mermaid opens (there may be other code blocks too)
    expect(closes).toBeGreaterThanOrEqual(opens)
    expect(opens).toBe(3)
  })
})

describe('README core commands (VP4: command flag coverage)', () => {
  const coreCommands = [
    '`kata enter`',
    '`kata exit`',
    '`kata status`',
    '`kata can-exit`',
    '`kata link`',
    '`kata doctor`',
    '`kata batteries`',
    '`kata setup`',
  ]

  for (const cmd of coreCommands) {
    it(`documents core command ${cmd}`, () => {
      expect(readme).toContain(`#### ${cmd}`)
    })
  }
})

describe('README built-in modes (B1b)', () => {
  const modes = ['research', 'planning', 'implementation', 'task', 'freeform', 'verify', 'debug', 'onboard']

  for (const mode of modes) {
    it(`includes mode: ${mode}`, () => {
      expect(readme).toContain(`\`${mode}\``)
    })
  }

  it('documents task mode has no pushed condition', () => {
    // task mode row: tasks_complete and committed but NOT pushed
    const taskRow = readme.match(/\| `task` \| Task \|[^|\n]+\|[^|\n]+\|([^|\n]+)\|/)
    expect(taskRow).not.toBeNull()
    const stopConditions = taskRow![1]
    expect(stopConditions).toContain('tasks_complete')
    expect(stopConditions).toContain('committed')
    expect(stopConditions).not.toContain('pushed')
  })
})

describe('README template frontmatter schema (VP5: schema accuracy)', () => {
  const requiredFields = ['task_config', 'depends_on', 'steps', 'instruction']

  for (const field of requiredFields) {
    it(`documents frontmatter field: ${field}`, () => {
      expect(readme).toContain(field)
    })
  }
})
