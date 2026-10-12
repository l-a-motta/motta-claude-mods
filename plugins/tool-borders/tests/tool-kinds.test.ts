import { expect, test } from 'claude-code/testing'

import { classify, COLORS } from '../hooks/register.tsx'
import { CASES, COLORS_PINNED, ROOT } from './tool-kinds.cases.ts'

// savvy-progress keeps a copy of this classifier: these cases pin both.
test('classifies the shared cases as the copy in savvy-progress does', () => {
  for (const [tool, input, kind] of CASES) {
    const k = classify(tool, input, ROOT)
    expect([tool, `${k.family}/${k.reach}`]).toEqual([tool, kind])
  }
})

test('keeps the colors savvy-progress copied', () => {
  expect(COLORS).toEqual(COLORS_PINNED)
})
