// AI 新闻多渠道采集源
// 使用 NewsNow 标准架构

import type { NewsItem } from "@shared/types"
import { rss2json } from "#/utils/rss2json"

const RSS_FEEDS = [
  { name: 'Ars Technica AI', url: 'https://arstechnica.com/ai/feed/' },
  { name: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { name: 'Wired AI', url: 'https://www.wired.com/feed/tag/ai/latest/rss' },
]

async function fetchRSSNews(): Promise<NewsItem[]> {
  const allItems: NewsItem[] = []
  
  for (const feed of RSS_FEEDS) {
    try {
      const rss = await rss2json(feed.url)
      if (rss?.items) {
        for (const item of rss.items.slice(0, 10)) {
          allItems.push({
            id: item.id?.substring(0, 32) || item.link?.substring(0, 32) || '',
            title: item.title || '',
            url: item.link || '',
            pubDate: item.created,
            extra: {
              info: feed.name,
            }
          })
        }
      }
    } catch (error) {
      console.error(`RSS 失败 [${feed.name}]:`, error)
    }
  }
  
  return allItems
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
          // 只取 AI/ML 相关
          if (title.toLowerCase().match(/ai|ml|openai|llm|model|neural|machine learning/)) {
            items.push({
              id: `hn-${id}`,
              title,
              url: story.url,
              pubDate: new Date(story.time * 1000).toISOString(),
              extra: {
                info: `Score: ${story.score}`,
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

// 主采集函数 - 多渠道并行
export default defineSource(async () => {
  try {
    const allItems: NewsItem[] = []
    const seenUrls = new Set<string>()
    
    // 并行采集所有渠道
    const results = await Promise.all([
      fetchRSSNews(),
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
    
    // 按时间排序
    allItems.sort((a, b) => {
      const timeA = new Date(a.pubDate || 0).getTime()
      const timeB = new Date(b.pubDate || 0).getTime()
      return timeB - timeA
    })
    
    return allItems.slice(0, 50)
  } catch (error) {
    console.error('AI 新闻采集失败:', error)
    return []
  }
})
