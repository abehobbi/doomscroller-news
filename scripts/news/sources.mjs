// A deliberately small publisher set with complementary geographic and topic
// coverage. Every endpoint is a publisher-provided RSS feed; no page scraping
// and no credentials are required.
export const NEWS_SOURCES = [
  {
    id: 'cbc-canada', publisherId: 'cbc', name: 'CBC News',
    feedUrl: 'https://www.cbc.ca/cmlink/rss-canada', sourceUrl: 'https://www.cbc.ca/news/canada',
    topics: ['Canada'], regions: ['Canada'], language: 'en',
  },
  {
    id: 'bbc-world', publisherId: 'bbc', name: 'BBC News',
    feedUrl: 'https://feeds.bbci.co.uk/news/world/rss.xml', sourceUrl: 'https://www.bbc.com/news/world',
    topics: ['World'], regions: ['World'], language: 'en',
  },
  {
    id: 'bbc-technology', publisherId: 'bbc', name: 'BBC News',
    feedUrl: 'https://feeds.bbci.co.uk/news/technology/rss.xml', sourceUrl: 'https://www.bbc.com/news/technology',
    topics: ['Technology'], regions: ['World'], language: 'en',
  },
  {
    id: 'guardian-world', publisherId: 'guardian', name: 'The Guardian',
    feedUrl: 'https://www.theguardian.com/world/rss', sourceUrl: 'https://www.theguardian.com/world',
    topics: ['World'], regions: ['World'], language: 'en',
  },
  {
    id: 'guardian-science', publisherId: 'guardian', name: 'The Guardian',
    feedUrl: 'https://www.theguardian.com/science/rss', sourceUrl: 'https://www.theguardian.com/science',
    topics: ['Science'], regions: ['World'], language: 'en',
  },
  {
    id: 'guardian-culture', publisherId: 'guardian', name: 'The Guardian',
    feedUrl: 'https://www.theguardian.com/culture/rss', sourceUrl: 'https://www.theguardian.com/culture',
    topics: ['Culture'], regions: ['World'], language: 'en',
  },
  {
    id: 'npr-world', publisherId: 'npr', name: 'NPR',
    feedUrl: 'https://feeds.npr.org/1004/rss.xml', sourceUrl: 'https://www.npr.org/sections/world/',
    topics: ['World'], regions: ['World'], language: 'en',
  },
  {
    id: 'npr-health', publisherId: 'npr', name: 'NPR',
    feedUrl: 'https://feeds.npr.org/1128/rss.xml', sourceUrl: 'https://www.npr.org/sections/health/',
    topics: ['Health'], regions: ['World'], language: 'en',
  },
  {
    id: 'aljazeera-all', publisherId: 'aljazeera', name: 'Al Jazeera',
    feedUrl: 'https://www.aljazeera.com/xml/rss/all.xml', sourceUrl: 'https://www.aljazeera.com/',
    topics: ['World', 'International affairs'], regions: ['World'], language: 'en',
  },
]

