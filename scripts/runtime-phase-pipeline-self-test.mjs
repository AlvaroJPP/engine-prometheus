import assert from 'node:assert/strict'
import { RuntimePhasePipeline } from '../engine/runtime/RuntimePhasePipeline.ts'

const pipeline = new RuntimePhasePipeline()
pipeline.definePhase({ id: 'late', order: 30 })
pipeline.definePhase({ id: 'early', order: 10 })
pipeline.definePhase({ id: 'middle', order: 20 })
const calls = []
const context = { value: 0 }
pipeline.registerTask({
  id: 'late-task',
  phaseId: 'late',
  execute: (_dt, state) => { calls.push('late'); state.value += 1 },
})
pipeline.registerTask({
  id: 'early-b',
  phaseId: 'early',
  priority: 5,
  execute: (_dt, state) => { calls.push('early-b'); state.value += 10 },
})
pipeline.registerTask({
  id: 'early-a',
  phaseId: 'early',
  priority: -5,
  execute: (dt, state) => { calls.push(['early-a', dt]); state.value += 100 },
})
pipeline.registerTask({
  id: 'middle-task',
  phaseId: 'middle',
  execute: (_dt, state) => { calls.push('middle'); state.value += 1000 },
})
const report = pipeline.run(Number.NaN, context)
assert.deepEqual(calls, [['early-a', 0], 'early-b', 'middle', 'late'])
assert.equal(context.value, 1111)
assert.deepEqual(report.phases.map(phase => phase.phaseId), ['early', 'middle', 'late'])
assert.equal(report.candidateTaskCount, 4)
assert.equal(report.executedTaskCount, 4)
assert.equal(report.skippedTaskCount, 0)
assert.equal(report.failures.length, 0)

const delayedCalls = []
pipeline.registerTask({
  id: 'snapshot-mutation',
  phaseId: 'early',
  priority: -10,
  execute: () => {
    delayedCalls.push('first')
    if (!pipeline.listTasks().some(task => task.id === 'added-during-run')) {
      pipeline.registerTask({
        id: 'added-during-run',
        phaseId: 'late',
        execute: () => delayedCalls.push('added'),
      })
    }
  },
})
const snapshotReport = pipeline.run(0.25, context)
assert.equal(snapshotReport.candidateTaskCount, 5, 'tasks registered during a run must wait for the next run')
assert.equal(delayedCalls.includes('added'), false)
pipeline.run(0.25, context)
assert.equal(delayedCalls.filter(item => item === 'added').length, 1)

let failedRuns = 0
pipeline.registerTask({
  id: 'faulting',
  phaseId: 'middle',
  execute: () => {
    failedRuns += 1
    throw new Error('expected task fault')
  },
})
const originalConsoleError = console.error
console.error = () => {}
try {
  const failedReport = pipeline.run(1, context)
  assert.equal(failedReport.failures.length, 1)
  assert.equal(pipeline.listTasks().find(task => task.id === 'faulting')?.faulted, true)
  pipeline.run(1, context)
  assert.equal(failedRuns, 1, 'faulted tasks must stay suspended until reset')
  assert.equal(pipeline.resetTaskFault('faulting'), true)
  pipeline.run(1, context)
  assert.equal(failedRuns, 2)
} finally {
  console.error = originalConsoleError
}

assert.equal(pipeline.setTaskEnabled('late-task', false), true)
const disabledReport = pipeline.run(1, context)
assert.equal(disabledReport.phases.find(phase => phase.phaseId === 'late')?.skippedTaskCount, 1)
assert.equal(pipeline.setTaskEnabled('late-task', true), true)

let removedTaskCalls = 0
let removeLater
pipeline.registerTask({
  id: 'remove-earlier',
  phaseId: 'early',
  priority: -20,
  execute: () => removeLater(),
})
removeLater = pipeline.registerTask({
  id: 'remove-later',
  phaseId: 'early',
  priority: 20,
  execute: () => { removedTaskCalls += 1 },
})
pipeline.run(1, context)
assert.equal(removedTaskCalls, 0, 'unregistered tasks should be skipped even inside a stable snapshot')

assert.throws(() => pipeline.definePhase({ id: 'early', order: 40 }), /already exists/i)
assert.throws(() => pipeline.definePhase({ id: 'invalid', order: Number.POSITIVE_INFINITY }), /finite/i)
assert.throws(() => pipeline.registerTask({ id: 'bad-phase', phaseId: 'missing', execute: () => {} }), /unknown runtime phase/i)
assert.throws(() => pipeline.registerTask({ id: '  ', phaseId: 'early', execute: () => {} }), /must not be empty/i)
assert.throws(() => pipeline.registerTask({ id: 'early-a', phaseId: 'early', execute: () => {} }), /already registered/i)

const nestedPipeline = new RuntimePhasePipeline()
nestedPipeline.definePhase({ id: 'run', order: 0 })
nestedPipeline.registerTask({
  id: 'recursive',
  phaseId: 'run',
  execute: () => nestedPipeline.run(0, {}),
})
const errorsBefore = console.error
console.error = () => {}
try {
  const nestedReport = nestedPipeline.run(0, {})
  assert.equal(nestedReport.failures.length, 1)
  assert.match(String(nestedReport.failures[0].error), /cannot run recursively/i)
} finally {
  console.error = errorsBefore
}
nestedPipeline.dispose()
assert.throws(() => nestedPipeline.run(0, {}), /disposed/i)

pipeline.clear()
assert.equal(pipeline.taskCount, 0)
assert.equal(pipeline.phaseCount, 3, 'clear keeps phases reusable')
assert.equal(pipeline.listPhases().every(phase => phase.taskCount === 0), true)
pipeline.dispose()
assert.equal(pipeline.phaseCount, 0)
assert.throws(() => pipeline.registerTask({ id: 'after-dispose', phaseId: 'early', execute: () => {} }), /disposed/i)
console.log('Runtime phase pipeline self-test passed.')
