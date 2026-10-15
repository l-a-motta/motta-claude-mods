import { describe, expect, test } from 'claude-code/testing'

import { finish, fmtDuration, receiptFor, receiptPieces, textKey } from '../hooks/register.tsx'
import type { Receipt } from '../types'

const r = (over: Partial<Receipt> = {}): Receipt => ({ isRunning: false, agents: 2, edits: 5, errors: 0, durationMs: 157_000, reason: 'answer', costAdded: 0.62, ...over })
const line = (x: Receipt) => receiptPieces(x).pieces.map(p => [p.figure, p.word].filter(Boolean).join(' ')).join(' · ')

describe('the receipt line', () => {
  test('a finished turn: ✓, its time, every count, zeros included, and the cost it added', () => {
    expect(receiptPieces(r()).mark).toBe('✓')
    expect(line(r({ agents: 0 }))).toBe('2m37s · 0 agents · 5 edits · 0 errors · +$0.62')
  })

  test('figures take tool-borders\' hues when they say something; errors red, a dollar or more orange', () => {
    const colors = (x: Receipt) => receiptPieces(x).pieces.map(p => p.color)
    expect(colors(r())).toEqual([undefined, '#c0674a', '#b8a531', undefined, undefined])
    expect(colors(r({ agents: 0, errors: 2, costAdded: 2.97 }))).toEqual([undefined, undefined, '#b8a531', '#ef5350', '#ee8d3a'])
  })

  test('agents and edits are the pressable words', () => {
    expect(receiptPieces(r()).pieces.map(p => p.press)).toEqual([undefined, 'agents', 'edits', undefined, undefined])
  })

  test('stopped and failed turns say how they ended', () => {
    expect(line(r({ durationMs: 130_000 }))).toMatch(/^2m10s · /)
    expect(line(r({ reason: 'aborted', durationMs: 62_000 }))).toMatch(/^1m02s stopped · /)
    expect(receiptPieces(r({ reason: 'error' })).mark).toBe('✗')
  })
})

test('each turn keeps its own counts, time and cost, nothing carried from the turn before', () => {
  const done = finish(r({ agents: 4, edits: 0, durationMs: 0, costAdded: undefined }), { durationMs: 30_000, reason: 'answer', costAdded: 2.97 })
  expect([done.isRunning, done.agents, done.edits, done.errors, done.durationMs, done.costAdded]).toEqual([false, 4, 0, 0, 30_000, 2.97])
})

describe('finding the reply a receipt sits under', () => {
  const answer = 'I made the savvy changes.\n\n**Receipt**\nIt now goes under the last reply I write in each turn, counting only that turn.'
  const all = { [textKey(answer)]: r() }

  test('the block that ends the answer finds it, whitespace aside', () => {
    expect(receiptFor(all, answer.replace(/\n\n/g, '\n'))).toBeDefined()
    expect(receiptFor(all, '**Receipt**\nIt now goes under the last reply I write in each turn, counting only that turn.')).toBeDefined()
  })

  test('an earlier block, or a short one that merely ends the same way, does not', () => {
    expect(receiptFor(all, 'I made the savvy changes.')).toBeUndefined()
    expect(receiptFor(all, 'counting only that turn.')).toBeUndefined()
  })
})

test('durations read as seconds, then minutes, then hours', () => {
  expect([fmtDuration(7_400), fmtDuration(157_000), fmtDuration(3_840_000)]).toEqual(['7s', '2m37s', '1h04m'])
})

test('a reply with no receipt draws as the engine draws it', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, () => ({ type: 'engine', ref: 1 }) as never)
  const ui = await $.ui.mount({ plugin: 'turn-receipt', surface: 'desktop', component: 'AssistantMessage', requestId: 'm1', props: { text: 'hi', isFirstOfReply: true } } as never)
  expect(JSON.stringify(await ui.drawn())).not.toMatch(/agents/)
})
