import { XMLParser } from 'fast-xml-parser'

interface NewsItem {
  id: string
  title: string
  url: string
  source: string
  published: string
  summary: string
  category: string
}

const RSS_FEEDS = [
  { name: 'Ars Technica AI', url: 'https://arstechnica.com/ai/feed/', category: 'AI' },
  { name: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', category: 'AI' },
  { name: 'Wired AI', url: 'https://www.wired.com/feed/tag/ai/latest/rss', category: 'AI' },
]

function generateId(url: string): string {
  const encoder = new TextEncoder()
  const data = encoder.encode(url)
  const hash = crypto.subtle.digest('MD5', data).then(buf => 
    Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16)
  )
  return hash.toString()
}

async function parseRSS(url: string, sourceName: string): Promise<NewsItem[]> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (NewsNow/1.0)' }
    })
    
    if (!response.ok) return []
    
    const xml = await response.text()
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
    const parsed = parser.parse(xml)
    const items: NewsItem[] = []
    
    const channel = parsed.rss?.channel || parsed.feed
    const entries = channel?.item || channel?.entry || []
    const entryArray = Array.isArray(entries) ? entries : [entries]
    
    for (const entry of entryArray.slice(0, 10)) {
      const title = entry.title || ''
      const link = entry.link?.['@_href'] || entry.link || entry.id || ''
      const description = entry.description || entry.summary || ''
      const pubDate = entry.pubDate || entry.published || entry.updated || ''
      
      if (title && link) {
        items.push({
          id: generateId(link.toString()),
          title: title.toString().trim(),
          url: link.toString().trim(),
          source: sourceName,
          published: pubDate?.toString() || '',
          summary: description?.toString().replace(/<[^>]*>/g, '').substring(0, 300) || '',
          category: 'AI'
        })
      }
    }
    
    return items
  } catch (error) {
    console.error(`RSS 解析失败 [${sourceName}]:`, error)
    return []
  }
}

async function fetchHackerNews(): Promise<NewsItem[]> {
  try {
    const topStories = await $fetch('https://hacker-news.firebaseio.com/v0/topstories.json')
    const items: NewsItem[] = []
    
    for (const id of topStories.slice(0, 20)) {
      try {
        const story = await $fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
        if (story?.type === 'story' && story.url) {
          const title = story.title || ''
          if (title.toLowerCase().match(/ai|ml|openai|llm|model|neural/)) {
            items.push({
              id: generateId(story.url),
              title,
              url: story.url,
              source: 'Hacker News',
              published: new Date(story.time * 1000).toISOString(),
              summary: `Score: ${story.score}`,
              category: 'tech'
            })
          }
        }
      } catch {}
    }
    return items
  } catch {
    return []
  }
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const limit = Math.min(parseInt(query.limit as string) || 20, 50)
  const hours = parseInt(query.hours as string) || 24
  const category = query.category as string
  
  const allItems: NewsItem[] = []
  const seenUrls = new Set<string>()
  
  try {
    const results = await Promise.all([
      ...RSS_FEEDS.map(source => parseRSS(source.url, source.name)),
      fetchHackerNews()
    ])
    
    for (const items of results) {
      for (const item of items) {
        if (!seenUrls.has(item.url)) {
          seenUrls.add(item.url)
          allItems.push(item)
        }
      }
    }
    
    const cutoff = Date.now() - (hours * 60 * 60 * 1000)
    const filtered = allItems.filter(item => {
      if (!item.published) return true
      return new Date(item.published).getTime() > cutoff
    })
    
    filtered.sort((a, b) => new Date(b.published || 0).getTime() - new Date(a.published || 0).getTime())
    const final = category ? filtered.filter(item => item.category === category) : filtered
    
    return {
      status: 'success',
      timestamp: new Date().toISOString(),
      data: final.slice(0, limit),
      total: final.length
    }
  } catch (error) {
    console.error('NewsNow API 错误:', error)
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
      data: [],
      total: 0
    }
  }
})
