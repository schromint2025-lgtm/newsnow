/**
 * NewsNow 多渠道新闻采集 API
 * GET /api/newsnow?limit=20&hours=24&category=AI
 */

import { Hono } from 'hono'
import { XMLParser } from 'fast-xml-parser'

const app = new Hono()

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

async function parseRSS(url: string, sourceName: string): Promise<any[]> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (NewsNow/1.0)' }
    })
    
    if (!response.ok) return []
    
    const xml = await response.text()
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
    const parsed = parser.parse(xml)
    const items: any[] = []
    
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

async function fetchHackerNews(): Promise<any[]> {
  try {
    const topStories = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json').then(res => res.json())
    const items: any[] = []
    
    for (const id of topStories.slice(0, 20)) {
      try {
        const story = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then(res => res.json())
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

async function collectNews(limit = 20, hours = 24) {
  const allItems: any[] = []
  const seenUrls = new Set<string>()
  
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
  return filtered.slice(0, limit)
}

app.get('/', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 50)
  const hours = parseInt(c.req.query('hours') || '24')
  const category = c.req.query('category')
  
  const news = await collectNews(limit, hours)
  const filtered = category ? news.filter(item => item.category === category) : news
  
  return c.json({
    status: 'success',
    timestamp: new Date().toISOString(),
    data: filtered,
    total: filtered.length
  })
})

app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

export default app
