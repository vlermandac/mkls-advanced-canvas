// Authored by Codex (LLM agent). Observable YAML and evidence-preservation regressions.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseProperties, PropertyService, editingSource, splitEditingSource } from '../src/property-graph/properties'

test('typed values distinguish null, false, zero, empty, lists and literal prototype keys', () => {
  const result = parseProperties('nil: null\nflag: false\nzero: 0\nempty: ""\nlist: [one, 2]\n__proto__: safe\nconstructor: literal\nwhen: 2026-10-12\n')
  assert.equal(result.errors.length, 0)
  assert.equal(result.values?.nil, null); assert.equal(result.values?.flag, false)
  assert.equal(result.values?.zero, 0); assert.equal(result.values?.empty, '')
  assert.equal(result.values?.__proto__, 'safe'); assert.equal(result.values?.constructor, 'literal')
  assert.equal(result.values?.when, '2026-10-12')
  assert.equal(Object.getPrototypeOf(result.values), null)
})
test('duplicates, non-finite values, sequences and cycles are diagnosed', () => {
  for (const yaml of ['x: 1\nx: 2\n', 'x: .inf', '[1, 2]', 'x: &x {y: *x}']) assert.equal(parseProperties(yaml).values, null, yaml)
})
test('raw comments, body mathematics and literal later fences survive editing', () => {
  const yaml = '# Exact comment\nlabels: ["math:Proof"]\n'
  const body = '$A^{\\top}A$\n---\nBody after a horizontal rule\n'
  assert.deepEqual(splitEditingSource(editingSource(yaml, body)), { yaml, body })
})
test('per-element revision cache invalidates only changed YAML', () => {
  const service = new PropertyService()
  const one = { id: 'one', propertyGraph: { version: 1 as const, yaml: 'x: 1\n' } }
  service.get(one); service.get({ ...one, color: '2' }); assert.equal(service.parseCount, 1)
  service.get({ ...one, propertyGraph: { version: 1, yaml: 'x: 2\n' } }); assert.equal(service.parseCount, 2)
})
