import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCaptionResponse, CANONICAL_CATEGORIES } from './CaptionService.js';

test('parses clean JSON reply', () => {
  const out = parseCaptionResponse(
    '{"description": "a man drifting a red BMW at night", "categories": ["Automotive"], "tags": ["drift", "bmw", "night"]}'
  );
  assert.equal(out.description, 'a man drifting a red BMW at night');
  assert.deepEqual(out.categories, ['Automotive']);
  assert.deepEqual(out.tags, ['drift', 'bmw', 'night']);
});

test('parses JSON wrapped in markdown fences and prose', () => {
  const out = parseCaptionResponse(
    'Here you go:\n```json\n{"description": "a cat on a piano", "categories": ["music"], "tags": ["Cat", "PIANO"]}\n```'
  );
  assert.equal(out.description, 'a cat on a piano');
  assert.deepEqual(out.categories, ['Music']); // case-normalized to canonical
  assert.deepEqual(out.tags, ['cat', 'piano']); // tags lowercased
});

test('drops categories outside the canonical list', () => {
  const out = parseCaptionResponse(
    '{"description": "x", "categories": ["Cooking Show", "Gaming", "Sky"], "tags": []}'
  );
  assert.deepEqual(out.categories, ['Gaming']);
});

test('falls back to plain sentence when no JSON', () => {
  const out = parseCaptionResponse('a dog running on a beach');
  assert.equal(out.description, 'a dog running on a beach');
  assert.deepEqual(out.categories, []);
  assert.deepEqual(out.tags, []);
});

test('empty input gives empty result', () => {
  const out = parseCaptionResponse('');
  assert.equal(out.description, '');
});

test('caps tags at 8 and dedupes', () => {
  const tags = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'a'];
  const out = parseCaptionResponse(
    JSON.stringify({ description: 'x', categories: [], tags })
  );
  assert.equal(out.tags.length, 8);
});

test('canonical list matches GoUpload taxonomy size', () => {
  assert.equal(CANONICAL_CATEGORIES.length, 13);
});
