// NewsNow 多渠道新闻采集 API
// GET /api/newsnow?limit=20&hours=24&category=AI

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

async function parseRSS(url: string, sourceName: string): Promise<NewsItem[]> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (NewsNow/1.0)' }
    })
    
    if (!response.ok) return []
    
    const xml = await response.text()
    const items: NewsItem[] = []
    
    // 简单 XML 解析
    const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g)
    for (const match of Array.from(itemMatches).slice(0, 10)) {
      const itemXml = match[1]
      const title = itemXml.match(/<title>([\s\S]*?)<\/title>/)?.[1] || ''
      const link = itemXml.match(/<link>([\s\S]*?)<\/link>/)?.[1] || ''
      const description = itemXml.match(/<description>([\s\S]*?)<\/description>/)?.[1] || ''
      const pubDate = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || ''
      
      if (title && link) {
        const cleanLink = link.replace(/&amp;/g, '&')
        items.push({
          id: cleanLink.substring(0, 16),
          title: title.trim(),
          url: cleanLink,
          source: sourceName,
          published: pubDate,
          summary: description.replace(/<[^>]*>/g, '').substring(0, 300),
          category: 'AI'
        })
      }
    }
    
    return items
  } catch (error) {
    console.error(`RSS 失败 [${sourceName}]:`, error)
    return []
  }
}

async function fetchHackerNews(): Promise<NewsItem[]> {
  try {
    const topStories: number[] = await $fetch('https://hacker-news.firebaseio.com/v0/topstories.json')
    const items: NewsItem[] = []
    
    for (const id of topStories.slice(0, 20)) {
      try {
        const story = await $fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
        if (story?.type === 'story' && story.url) {
          const title = story.title || ''
          if (title.toLowerCase().match(/ai|ml|openai|llm|model|neural/)) {
            items.push({
              id: story.url.substring(0, 16),
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
  try {
    const query = getQuery(event)
    const limit = Math.min(parseInt(query.limit as string) || 20, 50)
    const hours = parseInt(query.hours as string) || 24
    const category = query.category as string
    
    const allItems: NewsItem[] = []
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
    const final = category ? filtered.filter(item => item.category === category) : filtered
    
    return {
      status: 'success',
      timestamp: new Date().toISOString(),
      data: final.slice(0, limit),
      total: final.length
    }
  } catch (error) {
    console.error('API 错误:', error)
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
      data: [],
      total: 0
    }
  }
})
