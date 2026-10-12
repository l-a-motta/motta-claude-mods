import { expect, test } from 'claude-code/testing'

import { classify, COLORS } from '../hooks/tool-kinds.ts'
import { CASES, COLORS_PINNED, ROOT } from './tool-kinds.cases.ts'

// The copy of tool-borders' classifier says what tool-borders says.
test('classifies the shared cases as tool-borders does', () => {
  for (const [tool, input, kind] of CASES) {
    const k = classify(tool, input, ROOT)
    expect([tool, `${k.family}/${k.reach}`]).toEqual([tool, kind])
  }
})

test("has tool-borders' colors", () => {
  expect(COLORS).toEqual(COLORS_PINNED)
})
