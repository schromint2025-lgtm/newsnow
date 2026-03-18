// NewsNow API - 多渠道 AI 新闻采集
// 符合 NewsNow 架构的类型和格式

interface NewsItem {
  id: string
  title: string
  url: string
  pubDate?: string
  extra?: {
    info?: string
  }
}

const RSS_FEEDS = [
  { name: 'Ars Technica AI', url: 'https://arstechnica.com/ai/feed/' },
  { name: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { name: 'Wired AI', url: 'https://www.wired.com/feed/tag/ai/latest/rss' },
]

async function parseRSS(url: string): Promise<NewsItem[]> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (NewsNow/1.0)' }
    })
    
    if (!response.ok) return []
    
    const xml = await response.text()
    const items: NewsItem[] = []
    
    // 简单 XML 解析（不依赖外部库）
    const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g)
    for (const match of Array.from(itemMatches).slice(0, 15)) {
      const itemXml = match[1]
      const title = itemXml.match(/<title>([\s\S]*?)<\/title>/)?.[1] || ''
      const link = itemXml.match(/<link>([\s\S]*?)<\/link>/)?.[1] || ''
      const description = itemXml.match(/<description>([\s\S]*?)<\/description>/)?.[1] || ''
      const pubDate = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || ''
      
      if (title && link) {
        const cleanLink = link.replace(/&amp;/g, '&')
        items.push({
          id: cleanLink.substring(0, 32),
          title: title.trim(),
          url: cleanLink,
          pubDate,
          extra: {
            info: description.replace(/<[^>]*>/g, '').substring(0, 100)
          }
        })
      }
    }
    
    return items
  } catch (error) {
    console.error(`RSS 失败：`, error)
    return []
  }
}

async function fetchHackerNews(): Promise<NewsItem[]> {
  try {
    const topStories: number[] = await $fetch('https://hacker-news.firebaseio.com/v0/topstories.json')
    const items: NewsItem[] = []
    
    for (const id of topStories.slice(0, 30)) {
      try {
        const story = await $fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
        if (story?.type === 'story' && story.url) {
          const title = story.title || ''
          if (title.toLowerCase().match(/ai|ml|openai|llm|model|neural/)) {
            items.push({
              id: `hn-${id}`,
              title,
              url: story.url,
              pubDate: new Date(story.time * 1000).toISOString(),
              extra: {
                info: `Score: ${story.score}`
              }
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
    
    const allItems: NewsItem[] = []
    const seenUrls = new Set<string>()
    
    // 并行采集
    const results = await Promise.all([
      ...RSS_FEEDS.map(source => parseRSS(source.url)),
      fetchHackerNews()
    ])
    
    // 合并去重
    for (const items of results) {
      for (const item of items) {
        if (!seenUrls.has(item.url)) {
          seenUrls.add(item.url)
          allItems.push(item)
        }
      }
    }
    
    // 排序
    allItems.sort((a, b) => {
      const timeA = new Date(a.pubDate || 0).getTime()
      const timeB = new Date(b.pubDate || 0).getTime()
      return timeB - timeA
    })
    
    return {
      status: 'success' as const,
      timestamp: new Date().toISOString(),
      data: allItems.slice(0, limit),
      total: allItems.length
    }
  } catch (error) {
    console.error('API 错误:', error)
    return {
      status: 'error' as const,
      message: error instanceof Error ? error.message : 'Unknown error',
      data: [],
      total: 0
    }
  }
})
