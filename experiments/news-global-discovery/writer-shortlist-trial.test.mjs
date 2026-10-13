import test from 'node:test'
import assert from 'node:assert/strict'
import { auditWriterTemporalExposure, buildWriterSafeTemporalPacket, normalizeTemporalFact } from '../../artifacts/summary-feasibility/writer-safe-temporal-input-fix/writer-safe-temporal.mjs'
import { bindLeadingCoreferences, buildContextIndex, buildTrialItem, buildVerificationIndex, chooseTrialCandidates, geographyAudit, LANES, normalizeExplicitToday, numericAudit, partitionWriterExposure, relativeTimeAudit, writerEvidencePreflight, writerMetadataAudit } from './writer-shortlist-trial.mjs'

test('trial chooses one multi-source candidate from every lane and prefers Syria in a priority tie', () => {
  const item = (eventId, lane, sources, regions = []) => ({ eventId, lane, headline: eventId, evidence: 'A complete factual sentence explains the event. Another complete sentence explains why it matters.', publishedAt: '2026-10-10T00:00:00Z', priorityRegions: regions, editorialRecommendation: 'strong', editorialScore: 90, independentSourceCount: sources, primarySource: { publisher: 'bbc.com', url: `https://bbc.com/${eventId}` }, sources: [{ publisher: 'bbc.com', url: `https://bbc.com/${eventId}` }] })
  const selected = LANES.flatMap(lane => lane === 'priority-major'
    ? [item('canada', lane, 2, ['Canada']), item('syria', lane, 2, ['Syria'])]
    : [item(lane, lane, 2)])
  const chosen = chooseTrialCandidates({ selected })
  assert.equal(chosen.length, 5)
  assert.equal(chosen.find(value => value.lane === 'priority-major').eventId, 'syria')
})

test('trial packet exposes only propositions from verified supporting sources', () => {
  const candidate = { eventId: 'e1', lane: 'world-major', headline: 'Headline', evidence: 'The event happened in one place. Officials confirmed the outcome.', publishedAt: '2026-10-10T00:00:00Z', priorityRegions: [], independentSourceCount: 2, primarySource: { publisher: 'bbc.com', url: 'https://bbc.com/a' }, sources: [{ publisher: 'bbc.com', url: 'https://bbc.com/a' }, { publisher: 'reuters.com', url: 'https://reuters.com/a' }, { publisher: 'unknown.com', url: 'https://unknown.com/a' }] }
  const reports = [{ results: [{ accepted: [{ domain: 'reuters.com', url: 'https://reuters.com/a', propositions: ['Reuters independently reported the same event.', 'Its report supplied additional detail.'] }] }] }]
  const item = buildTrialItem(candidate, buildVerificationIndex(reports))
  assert.equal(item.temporalPacket.writer_facing.secondarySourceAdditions.length, 1)
  assert.equal(item.temporalPacket.writer_facing.secondarySourceAdditions[0].publisher, 'reuters.com')
})

test('source-repair additions enter the writer only through their verified propositions', () => {
  const supporting = { title: 'Independent report', domain: 'reuters.com', publisher: 'reuters.com', url: 'https://reuters.com/repaired', publishedAt: '2026-10-10T01:00:00Z', propositions: ['Reuters independently reported the same event.', 'The report supplied a concrete additional fact.'] }
  const candidate = { eventId: 'e2', lane: 'world-major', headline: 'Headline', evidence: 'The event happened. Officials described its consequence.', publishedAt: '2026-10-10T00:00:00Z', priorityRegions: [], independentSourceCount: 1, primarySource: { publisher: 'bbc.com', url: 'https://bbc.com/b' }, sources: [{ publisher: 'bbc.com', url: 'https://bbc.com/b' }], supportingSources: [supporting] }
  const item = buildTrialItem(candidate, buildVerificationIndex([{ results: [{ accepted: [supporting] }] }]))
  assert.equal(item.sources.length, 2)
  assert.equal(item.temporalPacket.writer_facing.secondarySourceAdditions[0].publisher, 'reuters.com')
})

test('temporal preflight separates safe writer packets from unresolved relative timing', () => {
  const packet = (writerText, expressions = []) => ({
    writer_facing: { fact: writerText },
    internal_audit: {
      publication_timestamp: null, article_updated_timestamp: null,
      original_relative_expressions: expressions,
      deterministic_temporal_context: { event_date: null },
    },
  })
  const safe = { eventId: 'safe', temporalPacket: packet('The community completed the project.') }
  const resolvedQuote = { eventId: 'resolved-quote', temporalPacket: {
    writer_facing: { fact: 'A resident said “I heard about it on Sunday.”', date: 'October 10, 2026' },
    internal_audit: { publication_timestamp: null, article_updated_timestamp: null, original_relative_expressions: [{ raw_expression: 'on Sunday', resolution_status: 'resolved' }], deterministic_temporal_context: { event_date: '2026-10-10' } },
  } }
  const blocked = { eventId: 'blocked', temporalPacket: packet('The community expects to complete the project this year.', [{ raw_expression: 'this year', resolution_status: 'unresolved' }]) }
  const partition = partitionWriterExposure([safe, resolvedQuote, blocked])
  assert.deepEqual(partition.ready.map(value => value.item.eventId), ['safe', 'resolved-quote'])
  assert.deepEqual(partition.blocked.map(value => value.item.eventId), ['blocked'])
})

test('writer packet drops quoted propositions whose unresolved timing survives normalization', () => {
  const source = '“One day later, on Monday at 4 p.m., we received the news.”'
  const companion = 'The report was published on Monday.'
  const packet = buildWriterSafeTemporalPacket({
    sourcePublicationTime: '2026-10-12T12:00:00Z', sourceUpdateTime: null,
    eventTimeOrWindow: [], coreFactualPropositions: [source, companion], secondarySourceAdditions: [],
    primaryNarrativeSource: { sourceId: 'primary:test', completeFactualPropositions: [source, companion] },
    curatorInstructions: [],
  }, { sourceTimezone: 'UTC' })
  assert.equal(packet.writer_facing.coreFactualPropositions.some(value => value.includes('received the news')), false)
  assert.equal(packet.writer_facing.primaryNarrativeSource.completeFactualPropositions.some(value => value.includes('received the news')), false)
  assert.equal(auditWriterTemporalExposure(packet).passes, true)
})

test('numeric audit recognizes a preserved approximate quarter-million expression', () => {
  const packet = { fact: 'The project cost almost a quarter of a million Canadian dollars.' }
  const preserved = { headline: 'Project update', pages: [{ text: 'The project cost nearly 250,000 Canadian dollars.' }] }
  const overstated = { headline: 'Project update', pages: [{ text: 'The project cost 250,000 Canadian dollars.' }] }
  assert.equal(numericAudit(preserved, packet).valid, true)
  assert.equal(numericAudit(overstated, packet).valid, false)
})

test('numeric audit recognizes supported written-number and punctuation equivalents', () => {
  const packet = {
    facts: [
      'Ninety-four percent of residents lack adequate shelter.',
      'The shelter houses 44,457 people.',
      'Seventeen years ago, a river island emerged.',
      'The craftsperson has worked for three decades.',
    ],
  }
  const card = {
    headline: '94% lack shelter',
    pages: [{ text: 'The shelter houses 44,457 people. The island emerged 17 years ago, and the craftsperson has worked for 30 years.' }],
  }
  assert.equal(numericAudit(card, packet).valid, true)
})

test('numeric audit recognizes Arabic decade wording translated into English decades', () => {
  const packet = { fact: 'كانت الحرفة رائدة من سبعينيات القرن الماضي إلى تسعينياته.' }
  const card = { headline: 'Craft revived', pages: [{ text: 'The craft was prominent from the 1970s through the 1990s.' }] }
  assert.equal(numericAudit(card, packet).valid, true)
})

test('numeric audit preserves source-backed metric and imperial length units', () => {
  const card = { headline: 'Fort found', pages: [{ text: 'The 395-metre summit is 1,300ft high and lies 2 miles away.' }], uncertainties: [] }
  const packet = { fact: 'The 395-metre (1,300ft) summit lies approximately 2 miles away.' }
  assert.equal(numericAudit(card, packet).valid, true)
})

test('numeric audit rejects a lower-bound figure stated as an exact count', () => {
  const packet = { fact: 'More than one million people were affected.' }
  const preserved = { headline: 'More than 1 million affected', pages: [] }
  const collapsed = { headline: '1 million affected', pages: [] }
  assert.equal(numericAudit(preserved, packet).valid, true)
  assert.deepEqual(numericAudit(collapsed, packet).qualifierMismatches, ['1 million'])
  assert.equal(numericAudit(collapsed, packet).valid, false)
})

test('relative-time audit rejects a next-week claim absent from the packet', () => {
  const packet = { temporal_facts_writer_may_state: { unresolved_relative_time: [] } }
  const card = { headline: 'Trial update', pages: [{ text: 'The trial is scheduled to begin next week.' }] }
  assert.deepEqual(relativeTimeAudit(card, packet).unsupportedExpressions, ['next week'])
})

test('relative-time audit preserves a source-backed quoted fight tonight slogan', () => {
  const packet = { central_event_to_explain: { selected_story: "Commander says alliance is 'ready to fight tonight'" } }
  const card = { headline: 'Alliance strategy', pages: [{ text: 'The commander said the alliance was “ready to fight tonight” if attacked.' }] }
  assert.equal(relativeTimeAudit(card, packet).valid, true)
})

test('geography audit rejects province terminology for a Syrian governorate', () => {
  const item = { temporalPacket: { writer_facing: { geographicClassification: { priorityRegions: ['Syria'] } } } }
  assert.equal(geographyAudit({ headline: 'Base transferred', pages: [{ text: 'The base is in Hasakah province.' }] }, item).valid, false)
  assert.equal(geographyAudit({ headline: 'Base transferred', pages: [{ text: 'The base is in Hasakah Governorate.' }] }, item).valid, true)
})

test('writer metadata audit rejects leaked pipeline language', () => {
  const leaked = { headline: 'Profile', pages: [{ text: 'One independent source family is represented by the selection gate.' }] }
  const clean = { headline: 'Profile', pages: [{ text: 'The official profile describes his public art.' }] }
  assert.equal(writerMetadataAudit(leaked).valid, false)
  assert.equal(writerMetadataAudit(clean).valid, true)
})

test('writer-safe temporal normalization removes relative timing that cannot be resolved exactly', () => {
  const result = normalizeTemporalFact('Next week, K will go on trial in Hamburg. A judge refused to extradite him last year.', { publicationTime: '2026-10-10T12:00:00Z', timeZone: 'Europe/Berlin' })
  assert.equal(result.normalized_fact, 'K will go on trial in Hamburg. A judge refused to extradite him.')
  assert.deepEqual(result.resolutions.map(value => value.resolution_status), ['unresolved', 'unresolved'])
})

test('explicit parenthetical dates resolve today in either day-month order', () => {
  assert.equal(normalizeExplicitToday('Applications close today (October 12).', '2026-10-12T00:00:00Z'), 'Applications close on October 12, 2026.')
  assert.equal(normalizeExplicitToday('Applications close today (12 October).', '2026-10-12T00:00:00Z'), 'Applications close on October 12, 2026.')
})

test('an explicit parenthetical date safely resolves every today reference in one report', () => {
  const result = normalizeExplicitToday('The milestone was achieved today (11 October). Today at 3:34pm, the reactor became critical.', '2026-10-11T11:15:00Z')
  assert.equal(result, 'The milestone was achieved on October 11, 2026. On October 11, 2026 at 3:34pm, the reactor became critical.')
  assert.doesNotMatch(result, /\btoday\b/i)
})

test('leading pronoun propositions stay bound to the named antecedent', () => {
  assert.deepEqual(bindLeadingCoreferences([
    'Volodymyr Zhuravlyov is fighting extradition from Croatia.',
    'He was arrested in Warsaw on a German warrant.',
    'A Polish judge refused extradition.',
  ]), [
    'Volodymyr Zhuravlyov is fighting extradition from Croatia. He was arrested in Warsaw on a German warrant.',
    'A Polish judge refused extradition.',
  ])
})

test('writer-safe packet normalizes relative timing in the central story title', () => {
  const result = buildWriterSafeTemporalPacket({
    sourcePublicationTime: '2026-10-11T12:00:00Z', sourceUpdateTime: null,
    central_event_to_explain: { selected_story: 'Ontario will remove bike lanes on Tuesday', time_window: [] },
    writer_focus_instructions: ['CENTRAL EVENT TO EXPLAIN: Ontario will remove bike lanes on Tuesday'],
    primaryNarrativeSource: { sourceId: 'p1', completeFactualPropositions: [] },
    coreFactualPropositions: [], secondarySourceAdditions: [], curatorInstructions: [],
  }, { sourceTimezone: 'America/Toronto' })
  assert.equal(result.writer_facing.central_event_to_explain.selected_story, 'Ontario will remove bike lanes on October 6, 2026')
  assert.equal(result.writer_facing.writer_focus_instructions[0], 'CENTRAL EVENT TO EXPLAIN: Ontario will remove bike lanes on October 6, 2026')
  assert.equal(result.internal_audit.original_relative_expressions.some(value => value.raw_expression.toLowerCase() === 'on tuesday'), false)
})

test('trial packet adds only explicit source-backed context propositions', () => {
  const candidate = { eventId: 'e1', lane: 'priority-interesting', headline: 'Headline', evidence: 'A complete factual sentence explains the event.', publishedAt: '2026-10-10T00:00:00Z', priorityRegions: ['Ghana'], independentSourceCount: 1, primarySource: { publisher: 'example.com', url: 'https://example.com/a' }, sources: [{ publisher: 'example.com', url: 'https://example.com/a' }] }
  const contexts = [{ additions: [{ eventId: 'e1', publisher: 'gna.org.gh', url: 'https://gna.org.gh/context', propositions: ['Jema is in Aowin in Ghana’s Western North Region.'] }] }]
  const item = buildTrialItem(candidate, new Map(), buildContextIndex(contexts))
  assert.equal(item.temporalPacket.writer_facing.secondarySourceAdditions.length, 1)
  assert.deepEqual(item.temporalPacket.writer_facing.secondarySourceAdditions[0].completeFactualPropositions, ['Jema is in Aowin in Ghana’s Western North Region.'])
})

test('writer preflight blocks empty and publisher-boilerplate evidence before model use', () => {
  const item = propositions => ({ temporalPacket: { writer_facing: { coreFactualPropositions: propositions } } })
  assert.equal(writerEvidencePreflight(item([])).valid, false)
  const boilerplate = writerEvidencePreflight(item([
    'Please refresh the page or navigate elsewhere to be automatically logged in.',
    'We rely on your support to keep this work going and your contribution truly helps.',
  ]))
  assert.equal(boilerplate.valid, false)
  assert.match(boilerplate.reasons.join(' '), /boilerplate/)
})

test('writer preflight accepts a sufficiently detailed source-bound evidence packet', () => {
  const result = writerEvidencePreflight({ temporalPacket: { writer_facing: { coreFactualPropositions: [
    'Officials said the storm damaged homes across three districts and forced hundreds of residents into temporary shelters.',
    'Emergency crews restored the main road while health workers assessed water supplies and warned that further rain could slow recovery.',
    'The national weather service said the rainfall was the heaviest recorded in the area this year and advised residents to avoid flooded routes.',
  ] } } })
  assert.equal(result.valid, true)
})
