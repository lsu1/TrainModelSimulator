import { expect, it } from 'vitest'
import { auditClearances } from './clearance'
import { makeKatoPlan06 } from './katoPlan06'
import { TRAIN_TYPES } from './trains'

it.each(TRAIN_TYPES)('keeps the assembled plan clear of unintended obstructions for %s', trainType => {
  const layout = makeKatoPlan06()
  const issues = auditClearances({ ...layout, trainType, trains: undefined }).filter(issue => issue.severity === 'error')
  expect(issues).toEqual([])
}, 30000)
