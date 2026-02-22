#!/usr/bin/env tsx
/**
 * Eval runner — entry point for kata-wm agentic eval suite.
 *
 * Usage:
 *   npm run eval                              # Run all scenarios (fresh projects)
 *   npm run eval -- --scenario=task-mode      # Run one scenario
 *   npm run eval -- --project=/path/to/dir    # Run against existing project
 *   npm run eval -- --resume=<session_id> --answer="Summary"  # Resume paused session
 *   npm run eval -- --json                    # JSON output
 *   npm run eval -- --list                    # List available scenarios
 *   npm run eval -- --verbose                 # Stream agent output in real time
 *   npm run eval -- --judge                   # Run LLM-as-judge (default: claude)
 *   npm run eval -- --judge=gemini            # Judge with Gemini provider
 *   npm run eval -- --judge=codex             # Judge with Codex provider
 *   npm run eval -- --judge --judge-model=o3  # Override model for judge
 *   npm run eval -- --no-transcript           # Skip writing transcript files
 */

import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { runScenario, type EvalResult } from './harness.js'
import { taskModeScenario } from './scenarios/task-mode.js'
import { planningModeScenario } from './scenarios/planning-mode.js'
import { onboardScenario } from './scenarios/onboard.js'
import { researchModeScenario } from './scenarios/research-mode.js'
import { modeEntryScenario } from './scenarios/mode-entry.js'
import { askUserPauseScenario } from './scenarios/ask-user-pause.js'
import { planningAuthScenario } from './scenarios/planning-auth.js'
import { implAuthScenario } from './scenarios/impl-auth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TRANSCRIPT_DIR = resolve(__dirname, '../eval-transcripts')

// ─── Registry ─────────────────────────────────────────────────────────────────

const scenarios = [askUserPauseScenario, modeEntryScenario, onboardScenario, taskModeScenario, planningModeScenario, planningAuthScenario, implAuthScenario, researchModeScenario]

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const jsonMode = args.includes('--json')
const listMode = args.includes('--list')
const verbose = args.includes('--verbose')
const noTranscript = args.includes('--no-transcript')
// --judge or --judge=<provider> (not matching --judge-model)
const judgeArg = args.find((a) => a === '--judge' || (a.startsWith('--judge=') && !a.startsWith('--judge-')))
const judgeMode = !!judgeArg
const judgeProvider = judgeArg?.includes('=') ? judgeArg.split('=')[1] : 'claude'
const judgeModel = args.find((a) => a.startsWith('--judge-model='))?.split('=')[1]
const scenarioArg = args.find((a) => a.startsWith('--scenario='))?.split('=')[1]
const projectArg = args.find((a) => a.startsWith('--project='))?.split('=')[1]
const resumeArg = args.find((a) => a.startsWith('--resume='))?.split('=')[1]
const answerArg = args.find((a) => a.startsWith('--answer='))?.split('=')[1]

if (listMode) {
  console.log('Available scenarios:')
  for (const s of scenarios) {
    console.log(`  ${s.id.padEnd(24)} ${s.name}`)
  }
  process.exit(0)
}

// ─── Run ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const results: EvalResult[] = []
  let overallPassed = true
  const runTs = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

  // Resume mode — continue a paused session
  if (resumeArg) {
    // For resume, we need a scenario (for checkpoints) and a project dir
    const scenario = scenarioArg
      ? scenarios.find((s) => s.id === scenarioArg)
      : scenarios[0]

    if (!scenario) {
      process.stderr.write(`Unknown scenario: ${scenarioArg}\n`)
      process.exit(1)
    }

    if (projectArg) {
      scenario.projectDir = projectArg
    }

    if (!jsonMode) {
      process.stdout.write(`\n▶ Resuming: ${scenario.name} (session: ${resumeArg})\n`)
    }

    const transcriptPath = noTranscript
      ? undefined
      : resolve(TRANSCRIPT_DIR, `${scenario.id}-resume-${runTs}.jsonl`)

    const result = await runScenario(scenario, {
      verbose: verbose && !jsonMode,
      transcriptPath,
      resumeSessionId: resumeArg,
      resumeAnswer: answerArg,
      judge: judgeMode,
      judgeProvider,
      judgeModel,
    })
    results.push(result)

    if (!jsonMode) printResult(result)
    if (!result.passed && !result.pendingQuestion) overallPassed = false
  } else {
    // Normal mode — run scenarios
    const toRun = scenarioArg
      ? scenarios.filter((s) => s.id === scenarioArg)
      : scenarios

    if (toRun.length === 0) {
      process.stderr.write(`Unknown scenario: ${scenarioArg}\n`)
      process.stderr.write(`Available: ${scenarios.map((s) => s.id).join(', ')}\n`)
      process.exit(1)
    }

    if (!noTranscript) {
      mkdirSync(TRANSCRIPT_DIR, { recursive: true })
    }

    for (const scenario of toRun) {
      // Override project dir if --project flag provided
      if (projectArg) {
        scenario.projectDir = projectArg
      }

      if (!jsonMode) {
        process.stdout.write(`\n▶ Running: ${scenario.name} (${scenario.id})\n`)
        if (scenario.projectDir) {
          process.stdout.write(`  Project: ${scenario.projectDir}\n`)
        }
      }

      const transcriptPath = noTranscript
        ? undefined
        : resolve(TRANSCRIPT_DIR, `${scenario.id}-${runTs}.jsonl`)

      if (transcriptPath && !jsonMode) {
        process.stdout.write(`  Transcript: ${transcriptPath}\n`)
      }

      const result = await runScenario(scenario, {
        verbose: verbose && !jsonMode,
        transcriptPath,
        judge: judgeMode,
        judgeProvider,
        judgeModel,
      })
      results.push(result)

      if (!jsonMode) {
        printResult(result)
      }

      if (!result.passed && !result.pendingQuestion) overallPassed = false
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify({ passed: overallPassed, results }, null, 2))
  } else {
    printSummary(results)
  }

  process.exit(overallPassed ? 0 : 1)
}

function printResult(result: EvalResult): void {
  if (result.pendingQuestion) {
    console.log(`⏸ PAUSED ${result.scenarioName}`)
    console.log(`   Session: ${result.pendingQuestion.sessionId}`)
    console.log(`   Project: ${result.projectDir}`)
    console.log('   Questions:')
    for (const q of result.pendingQuestion.questions) {
      console.log(`     ${q.header}: ${q.question}`)
      for (let i = 0; i < q.options.length; i++) {
        console.log(`       ${i + 1}. ${q.options[i].label}`)
      }
    }
    console.log(`   Resume: npm run eval -- --scenario=${result.scenarioId} --project="${result.projectDir}" --resume=${result.pendingQuestion.sessionId} --answer="<choice>"`)
    return
  }

  const status = result.passed ? '✅ PASS' : '❌ FAIL'
  console.log(`${status} ${result.scenarioName}`)
  console.log(
    `   Turns: ${result.turns}  Tokens: ${result.inputTokens.toLocaleString()}in/${result.outputTokens.toLocaleString()}out  Duration: ${Math.round(result.durationMs / 1000)}s  Cost: $${result.costUsd.toFixed(4)}`,
  )
  console.log(`   Project: ${result.projectDir}`)

  for (const a of result.assertions) {
    const mark = a.passed ? '  ✓' : '  ✗'
    console.log(`${mark} ${a.name}`)
    if (!a.passed && a.error) {
      console.log(`    → ${a.error}`)
    }
  }

  if (result.transcriptPath) {
    console.log(`  📄 ${result.transcriptPath}`)
  }

  if (result.judgeResult) {
    const j = result.judgeResult
    const pLabel = j.provider ? ` [${j.provider}]` : ''
    console.log(`\n  Judge${pLabel}: Agent ${j.agentScore}/100 | System ${j.systemScore}/100 | ${j.verdict}`)
    if (result.judgeReviewPath) {
      console.log(`  Review: ${result.judgeReviewPath}`)
    }
  }
}

function printSummary(results: EvalResult[]): void {
  const passed = results.filter((r) => r.passed).length
  const paused = results.filter((r) => r.pendingQuestion).length
  const total = results.length
  const totalTokens = results.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0)
  const totalMs = results.reduce((s, r) => s + r.durationMs, 0)
  const totalCost = results.reduce((s, r) => s + r.costUsd, 0)

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`Results: ${passed}/${total} passed${paused > 0 ? `, ${paused} paused` : ''}`)
  console.log(`Total tokens: ${totalTokens.toLocaleString()}`)
  console.log(`Total time: ${Math.round(totalMs / 1000)}s`)
  console.log(`Total cost: $${totalCost.toFixed(4)}`)

  if (passed < total - paused) {
    const failed = results.filter((r) => !r.passed && !r.pendingQuestion).map((r) => r.scenarioId)
    console.log(`Failed: ${failed.join(', ')}`)
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
