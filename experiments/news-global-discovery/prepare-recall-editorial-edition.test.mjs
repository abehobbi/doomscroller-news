import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareRecallEditorialEdition } from './prepare-recall-editorial-edition.mjs'

test('editorial edition contains source-ready events only', () => {
  const event = (id, url) => ({ id, members: [{ snapshot: { finalUrl: url } }] })
  const output = prepareRecallEditorialEdition({ events: [event('ready', 'https://example.com/ready'), event('blocked', 'https://example.com/blocked')] }, { ready: [{ sources: [{ accepted: true, url: 'https://example.com/ready' }] }] }, { results: [] })
  assert.deepEqual(output.events.map(item => item.id), ['ready'])
})
