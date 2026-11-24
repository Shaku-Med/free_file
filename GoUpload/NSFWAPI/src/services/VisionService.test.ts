import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './VisionService.js';

const ss = (over: Partial<Record<'adult' | 'racy' | 'violence' | 'medical' | 'spoof', string>>) => ({
  adult: 'VERY_UNLIKELY',
  racy: 'VERY_UNLIKELY',
  violence: 'VERY_UNLIKELY',
  medical: 'VERY_UNLIKELY',
  spoof: 'VERY_UNLIKELY',
  ...over,
});

test('gore that also shows skin is harmful, not adult', () => {
  // The scores SafeSearch gave the photo that went out as 18+.
  const v = classify(ss({ adult: 'POSSIBLE', racy: 'VERY_LIKELY', violence: 'VERY_LIKELY', medical: 'LIKELY' }), ['thigh', 'flesh'], false);
  assert.deepEqual(v, { isNSFW: true, category: 'harmful', flagReason: 'violent content' });
});

test('harmful outranks explicit adult in the cheap frame gate too', () => {
  const v = classify(ss({ adult: 'VERY_LIKELY', violence: 'LIKELY' }), [], true);
  assert.equal(v.category, 'harmful');
});

test('graphic medical and harmful labels are harmful', () => {
  assert.equal(classify(ss({ medical: 'VERY_LIKELY' }), [], false).category, 'harmful');
  assert.equal(classify(ss({}), ['blood', 'beach'], false).flagReason, 'harmful labels: blood');
  // Labels never reach the gate, so they can't flag there.
  assert.equal(classify(ss({}), ['blood'], true).category, null);
});

test('adult rules are unchanged', () => {
  assert.equal(classify(ss({ adult: 'LIKELY' }), [], true).category, 'adult');
  assert.equal(classify(ss({ racy: 'VERY_LIKELY' }), ['person'], false).category, 'adult');
  assert.equal(classify(ss({ racy: 'VERY_LIKELY' }), ['bikini'], false).category, null);
  assert.equal(classify(ss({ racy: 'VERY_LIKELY' }), [], true).category, null);
});

test('clean stays clean', () => {
  assert.deepEqual(classify(ss({ violence: 'POSSIBLE', medical: 'LIKELY' }), ['car'], false), {
    isNSFW: false,
    category: null,
    flagReason: '',
  });
  assert.equal(classify(null, [], false).category, null);
});
