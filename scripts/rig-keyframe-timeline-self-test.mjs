import assert from 'node:assert/strict'
import {
  prepareRigAnimationFrames,
  upsertRigAnimationKeyframe,
} from '../src/lib/animation/RigKeyframeTimeline.ts'

const poseA = { Hips: { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] } }
const poseB = { Hips: { position: [1, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] } }
const poseC = { Hips: { position: [2, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] } }
const frame = (time, pose) => ({ time, pose })

const oneSecond = frame(1, poseA)
const halfSecond = frame(0.5, poseB)
const inserted = upsertRigAnimationKeyframe([oneSecond], halfSecond)
assert.deepEqual(inserted.map(item => item.time), [0.5, 1])
assert.equal(inserted[0].pose, poseB)
assert.deepEqual([oneSecond.time], [1], 'Insertion must not mutate the source frame')

const replacement = frame(1.0005, poseC)
const replaced = upsertRigAnimationKeyframe([frame(0, poseA), oneSecond, frame(2, poseB)], replacement)
assert.equal(replaced.length, 3, 'Frames within the tolerance should be replaced')
assert.equal(replaced[1], replacement, 'A replacement preserves its position in the timeline')
assert.equal(replaced[1].pose, poseC)

assert.equal(prepareRigAnimationFrames([]), null)
assert.equal(prepareRigAnimationFrames([frame(1, poseA)]), null)
assert.equal(prepareRigAnimationFrames([frame(1, poseA), frame(1, poseB)]), null)
assert.equal(prepareRigAnimationFrames([frame(0, poseA), frame(0, poseB)]), null)

const unorderedFrames = [frame(2, poseC), frame(1, poseB)]
const prepared = prepareRigAnimationFrames(unorderedFrames)
assert.ok(prepared)
assert.deepEqual(prepared.map(item => item.time), [0, 1, 2])
assert.equal(prepared[0].pose, poseB, 'The earliest pose is copied to time zero')
assert.equal(prepared[1].pose, poseB)
assert.deepEqual(unorderedFrames.map(item => item.time), [2, 1], 'Preparing frames must not mutate input')

const alreadyStartsAtZero = prepareRigAnimationFrames([frame(1, poseC), frame(0, poseA)])
assert.ok(alreadyStartsAtZero)
assert.deepEqual(alreadyStartsAtZero.map(item => item.time), [0, 1])
assert.equal(alreadyStartsAtZero[0].pose, poseA)

console.log('Rig keyframe timeline self-test passed.')
