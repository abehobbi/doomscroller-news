import test from 'node:test'
import assert from 'node:assert/strict'
import { evidenceMatchesDiscoveredTopic } from './audit-five-lane-edition.mjs'

const selection = title => ({ representative: { title } })
const snapshot = (title, evidenceText) => ({ title, evidenceText })

test('evidence topic gate rejects a generic homepage returned for a specific event', () => {
  assert.equal(evidenceMatchesDiscoveredTopic(
    selection('SUDAN DRONE STRIKE KILLS 41 DISPLACED PEOPLE, RIGHTS GROUP SAYS, Mission Offline'),
    snapshot('Mission Offline: Social & Creator Platform', 'A social platform for videos, communities, books, games and an independent newsroom.'),
  ), false)
})

test('evidence topic gate accepts a paraphrased article about the discovered event', () => {
  assert.equal(evidenceMatchesDiscoveredTopic(
    selection('Sudan drone strike kills 41 displaced people near Ethiopian border'),
    snapshot('Paramilitary drone attack kills dozens in Sudan', 'The strike hit a camp for displaced families close to the Ethiopia border.'),
  ), true)
})
