const q = (lane, id, query, objective, region = null) => ({ lane, id, query, objective, region })

const INTERESTING_WORLD_OBJECTIVE = 'Find a real, distinct, recently reported event or substantive piece of original reporting from anywhere in the world. Rank concrete stories with a strong human, surprising, revealing, or place-specific core. Prefer original local or regional journalism. Exclude tourism promotion, event listings, publicity, opinion, sport, celebrity news, generic explainers, and homepages.'
const INTERESTING_PRIORITY_OBJECTIVE = 'Find the strongest genuinely interesting, revealing, surprising, or deeply local recent reporting in the named priority region. This lane is broader than major news: include everyday life, traditions, livelihoods, unusual local developments, human rights, community responses, and distinctive original reporting. Exclude routine speeches, publicity, sport, celebrity news, and generic commentary.'
const MAJOR_WORLD_OBJECTIVE = 'Find consequential new worldwide developments with a clear action, decision, disclosure, measurable change, or human impact. Prefer independent reporting and primary facts. Exclude commentary-only stories, routine statements, publicity, sport, and celebrity news.'
const MAJOR_PRIORITY_OBJECTIVE = 'Find the most consequential recent developments specifically affecting the named priority region, including politics, conflict, law, economy, public health, infrastructure, environment, and human rights. Prefer concrete actions and verified developments over statements or political messaging.'
const DISCOVERY_OBJECTIVE = 'Find newly published, understandable discoveries or research developments with a strong concrete finding and broad human curiosity. Prefer original papers or responsible science journalism. Exclude incremental specialist results that cannot be explained meaningfully to a general reader, speculative press releases, and generic explainers.'

export const FIVE_LANE_QUERIES = [
  q('world-interesting', 'world-human-window', 'Recent original reporting that reveals a surprising or moving window into ordinary life in a specific underreported place anywhere in the world.', INTERESTING_WORLD_OBJECTIVE),
  q('world-interesting', 'world-local-surprise', 'A fascinating recent local story anywhere in the world involving an unexpected civic problem, administrative mistake, community response, or unusual consequence.', INTERESTING_WORLD_OBJECTIVE),
  q('world-interesting', 'world-tradition-livelihood', 'Recent original reporting about a living tradition, livelihood, harvest, food practice, craft, or changing way of life in a specific place.', INTERESTING_WORLD_OBJECTIVE),
  q('world-interesting', 'world-community-change', 'A recently reported distinctive change, experiment, or adaptation in a village, neighbourhood, island, small town, school, farm, or local institution.', INTERESTING_WORLD_OBJECTIVE),
  q('world-interesting', 'world-nature-people', 'A compelling recent story about people interacting with unusual wildlife, restoring a landscape, or responding to a local environmental change.', INTERESTING_WORLD_OBJECTIVE),
  q('world-interesting', 'world-rights-investigation', 'A recently published investigation or deeply reported local human-rights story with a concrete surprising finding outside routine international headlines.', INTERESTING_WORLD_OBJECTIVE),
  q('world-interesting', 'world-extraordinary-person', 'A recently reported true story about an extraordinary person, late-life achievement, unusual occupation, or individual whose life reveals something larger about a place.', INTERESTING_WORLD_OBJECTIVE),
  q('world-interesting', 'world-best-open', 'The strongest fascinating and at least somewhat niche true story published recently anywhere in the world, regardless of subject or country.', INTERESTING_WORLD_OBJECTIVE),

  q('priority-interesting', 'syria-interesting', 'The strongest interesting, revealing, surprising, human, cultural, or deeply local recent story from Syria, including reporting in or translated from Arabic.', INTERESTING_PRIORITY_OBJECTIVE, 'Syria'),
  q('priority-interesting', 'middle-east-interesting', 'The strongest interesting, revealing, surprising, human, cultural, or deeply local recent story from the Middle East beyond Syria.', INTERESTING_PRIORITY_OBJECTIVE, 'Middle East'),
  q('priority-interesting', 'bangladesh-interesting', 'The strongest interesting, revealing, surprising, human, cultural, environmental, or deeply local recent story from Bangladesh, including district-level reporting.', INTERESTING_PRIORITY_OBJECTIVE, 'Bangladesh'),
  q('priority-interesting', 'ghana-interesting', 'The strongest interesting, revealing, surprising, human, cultural, environmental, or deeply local recent story from Ghana, including regional reporting.', INTERESTING_PRIORITY_OBJECTIVE, 'Ghana'),
  q('priority-interesting', 'canada-interesting', 'The strongest interesting, revealing, surprising, human, cultural, environmental, or deeply local recent story from Canada outside routine national politics.', INTERESTING_PRIORITY_OBJECTIVE, 'Canada'),
  q('priority-interesting', 'gta-interesting', 'The strongest interesting, revealing, surprising, human, neighbourhood, or municipal recent story from Toronto, Mississauga, Brampton, Markham, Vaughan, Durham, Halton, Peel, or York Region.', INTERESTING_PRIORITY_OBJECTIVE, 'GTA'),

  q('world-major', 'world-major-politics-security', 'The most consequential new global political, diplomatic, conflict, security, election, or government development reported recently.', MAJOR_WORLD_OBJECTIVE),
  q('world-major', 'world-major-economy-law', 'The most consequential new global economic, legal, regulatory, labour, infrastructure, or technology-policy development reported recently.', MAJOR_WORLD_OBJECTIVE),
  q('world-major', 'world-major-health-disaster', 'The most consequential new worldwide public-health, disaster, climate, food-security, displacement, or humanitarian development reported recently.', MAJOR_WORLD_OBJECTIVE),
  q('world-major', 'world-major-open', 'The most important concrete news development anywhere in the world reported recently that an informed person should know.', MAJOR_WORLD_OBJECTIVE),

  q('priority-major', 'syria-major', 'The most consequential concrete new development affecting Syria reported recently.', MAJOR_PRIORITY_OBJECTIVE, 'Syria'),
  q('priority-major', 'middle-east-major', 'The most consequential concrete new development affecting the wider Middle East beyond Syria reported recently.', MAJOR_PRIORITY_OBJECTIVE, 'Middle East'),
  q('priority-major', 'bangladesh-major', 'The most consequential concrete new development affecting Bangladesh reported recently.', MAJOR_PRIORITY_OBJECTIVE, 'Bangladesh'),
  q('priority-major', 'ghana-major', 'The most consequential concrete new development affecting Ghana reported recently.', MAJOR_PRIORITY_OBJECTIVE, 'Ghana'),
  q('priority-major', 'canada-major', 'The most consequential concrete new national or provincial development affecting Canada reported recently.', MAJOR_PRIORITY_OBJECTIVE, 'Canada'),
  q('priority-major', 'gta-major', 'The most consequential concrete new development affecting Toronto or the Greater Toronto Area reported recently.', MAJOR_PRIORITY_OBJECTIVE, 'GTA'),

  q('discovery', 'discovery-science-health', 'The strongest newly published understandable scientific, medical, neuroscience, or psychology discovery with a concrete finding.', DISCOVERY_OBJECTIVE),
  q('discovery', 'discovery-archaeology-history', 'The strongest newly published archaeology, paleontology, ancient-history, fossil, or historical discovery with a concrete finding.', DISCOVERY_OBJECTIVE),
  q('discovery', 'discovery-nature-earth', 'The strongest newly published discovery about animals, plants, evolution, oceans, climate, geology, or Earth with a concrete finding.', DISCOVERY_OBJECTIVE),
  q('discovery', 'discovery-space-technology', 'The strongest newly published space, astronomy, physics, engineering, or broadly understandable technology discovery with a concrete finding.', DISCOVERY_OBJECTIVE),
]

export const UPDATE_LANES = new Set(['world-major', 'priority-major'])
