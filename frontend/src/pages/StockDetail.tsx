import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { ArrowLeft, BarChart3, ExternalLink, Newspaper, RefreshCw, Sparkles } from 'lucide-react'
import { fetchAPI } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { SuggestionBadge, type SuggestionInfo } from '@/components/suggestion-badge'
import { KlineSummaryDialog } from '@/components/kline-summary-dialog'

interface Stock {
  id: number
  symbol: string
  name: string
  market: string
  enabled: boolean
  agents?: Array<{
    agent_name: string
    schedule?: string
    ai_model_id?: number | null
    notify_channel_ids?: number[]
  }>
}

interface QuoteResponse {
  symbol: string
  market: string
  name: string | null
  current_price: number | null
  change_pct: number | null
  change_amount: number | null
  prev_close: number | null
  open_price: number | null
  high_price: number | null
  low_price: number | null
  volume: number | null
  turnover: number | null
}

interface NewsItem {
  source: string
  source_label: string
  external_id: string
  title: string
  content: string
  publish_time: string
  symbols: string[]
  importance: number
  url: string
}

interface HistoryRecord {
  id: number
  agent_name: string
  stock_symbol: string
  analysis_date: string
  title: string
  content: string
  suggestions?: Record<string, any> | null
  created_at: string
  updated_at: string
}

interface AgentResult {
  title: string
  content: string
  should_alert: boolean
  notified: boolean
}

const AGENT_LABELS: Record<string, string> = {
  daily_report: '盘后日报',
  premarket_outlook: '盘前分析',
  intraday_monitor: '盘中监测',
  news_digest: '新闻速递',
  chart_analyst: '技术分析',
}

const SOURCE_COLORS: Record<string, string> = {
  xueqiu: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  eastmoney_news: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20',
  eastmoney: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
}

const TIME_OPTIONS = [
  { value: '6', label: '近 6 小时' },
  { value: '12', label: '近 12 小时' },
  { value: '24', label: '近 24 小时' },
  { value: '48', label: '近 48 小时' },
  { value: '72', label: '近 72 小时' },
]

function marketBadge(market: string) {
  if (market === 'HK') return { style: 'bg-orange-500/10 text-orange-600', label: '港股' }
  if (market === 'US') return { style: 'bg-green-500/10 text-green-600', label: '美股' }
  return { style: 'bg-blue-500/10 text-blue-600', label: 'A股' }
}

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value == null) return '--'
  return value.toFixed(digits)
}

function formatTime(isoTime: string): string {
  if (!isoTime) return ''
  try {
    const d = new Date(isoTime)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  } catch {
    return ''
  }
}

export default function StockDetailPage() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const params = useParams()

  const symbol = (params.symbol || '').trim()
  const market = (params.market || 'CN').trim().toUpperCase()

  const [loading, setLoading] = useState(false)
  const [triggering, setTriggering] = useState(false)

  const [stock, setStock] = useState<Stock | null>(null)
  const [quote, setQuote] = useState<QuoteResponse | null>(null)

  const [includeExpired, setIncludeExpired] = useState(false)
  const [suggestions, setSuggestions] = useState<SuggestionInfo[]>([])

  const [newsHours, setNewsHours] = useState('72')
  const [news, setNews] = useState<NewsItem[]>([])

  const [history, setHistory] = useState<HistoryRecord[]>([])
  const [detailRecord, setDetailRecord] = useState<HistoryRecord | null>(null)

  const [batchReports, setBatchReports] = useState<Record<string, HistoryRecord | null>>({
    premarket_outlook: null,
    daily_report: null,
    news_digest: null,
  })

  // Kline dialog
  const [klineOpen, setKlineOpen] = useState(false)

  const [tab, setTab] = useState<'overview' | 'suggestions' | 'news' | 'history'>('overview')

  const resolvedName = useMemo(() => {
    if (stock?.name) return stock.name
    if (quote?.name) return quote.name
    return symbol
  }, [stock?.name, quote?.name, symbol])

  const loadStockBase = useCallback(async () => {
    if (!symbol) return
    try {
      const stocks = await fetchAPI<Stock[]>('/stocks')
      const found = stocks.find(s => s.symbol === symbol && s.market === market)
      setStock(found || null)
    } catch {
      setStock(null)
    }
  }, [symbol, market])

  const loadQuote = useCallback(async () => {
    if (!symbol) return
    try {
      const data = await fetchAPI<QuoteResponse>(`/quotes/${encodeURIComponent(symbol)}?market=${encodeURIComponent(market)}`)
      setQuote(data || null)
    } catch (e) {
      setQuote(null)
      toast(e instanceof Error ? e.message : '行情加载失败', 'error')
    }
  }, [symbol, market, toast])

  const loadSuggestions = useCallback(async () => {
    if (!symbol) return
    try {
      const params = new URLSearchParams()
      params.set('limit', '20')
      if (includeExpired) params.set('include_expired', 'true')
      const data = await fetchAPI<any[]>(`/suggestions/${encodeURIComponent(symbol)}?${params.toString()}`)
      const list = (data || []).map(item => ({
        action: item.action,
        action_label: item.action_label,
        signal: item.signal || '',
        reason: item.reason || '',
        should_alert: !!item.should_alert,
        agent_name: item.agent_name,
        agent_label: item.agent_label,
        created_at: item.created_at,
        is_expired: item.is_expired,
        prompt_context: item.prompt_context,
        ai_response: item.ai_response,
        raw: item.raw || '',
      })) as SuggestionInfo[]
      setSuggestions(list)
    } catch (e) {
      setSuggestions([])
      toast(e instanceof Error ? e.message : '建议加载失败', 'error')
    }
  }, [symbol, includeExpired, toast])

  const loadNews = useCallback(async () => {
    if (!symbol) return
    try {
      const params = new URLSearchParams()
      params.set('hours', newsHours)
      params.set('limit', '80')
      params.set('filter_related', 'true')

      // 优先用名称（更稳），否则退回用 symbol
      if (stock?.name) params.set('names', stock.name)
      else params.set('symbols', symbol)

      const data = await fetchAPI<NewsItem[]>(`/news?${params.toString()}`)
      setNews(data || [])
    } catch (e) {
      setNews([])
      toast(e instanceof Error ? e.message : '新闻加载失败', 'error')
    }
  }, [symbol, stock?.name, newsHours, toast])

  const loadHistory = useCallback(async () => {
    if (!symbol) return
    try {
      const params = new URLSearchParams()
      params.set('stock_symbol', symbol)
      params.set('limit', '50')
      const data = await fetchAPI<HistoryRecord[]>(`/history?${params.toString()}`)
      setHistory(data || [])
    } catch (e) {
      setHistory([])
      toast(e instanceof Error ? e.message : '历史加载失败', 'error')
    }
  }, [symbol, toast])

  const loadBatchReports = useCallback(async () => {
    const agentNames = ['premarket_outlook', 'daily_report', 'news_digest']
    const results = await Promise.allSettled(
      agentNames.map(a => fetchAPI<HistoryRecord[]>(`/history?agent_name=${encodeURIComponent(a)}&stock_symbol=*&limit=1`))
    )

    const next: Record<string, HistoryRecord | null> = {}
    agentNames.forEach((a, idx) => {
      const r = results[idx]
      if (r.status === 'fulfilled' && r.value && r.value.length > 0) next[a] = r.value[0]
      else next[a] = null
    })
    setBatchReports(next)
  }, [])

  const loadEssential = useCallback(async () => {
    if (!symbol) return
    setLoading(true)
    try {
      await loadStockBase()
      await Promise.allSettled([loadQuote(), loadHistory(), loadBatchReports()])
    } finally {
      setLoading(false)
    }
  }, [symbol, loadStockBase, loadQuote, loadHistory, loadBatchReports])

  const refreshAll = useCallback(async () => {
    if (!symbol) return
    setLoading(true)
    try {
      await loadStockBase()
      await Promise.allSettled([
        loadQuote(),
        loadSuggestions(),
        loadHistory(),
        loadBatchReports(),
      ])
      // news 依赖 stockName（更稳），放在 base load 后
      await loadNews()
    } finally {
      setLoading(false)
    }
  }, [symbol, loadStockBase, loadQuote, loadSuggestions, loadHistory, loadBatchReports, loadNews])

  useEffect(() => {
    loadEssential()
  }, [loadEssential])

  // includeExpired / hours 改变时刷新对应区域
  useEffect(() => {
    loadSuggestions()
  }, [loadSuggestions])
  useEffect(() => {
    loadNews()
  }, [loadNews])

  const triggerChartAnalyst = async () => {
    if (!stock?.id) {
      toast('该股票未在自选中，无法触发 Agent（请先添加到自选）', 'info')
      return
    }
    if (!(stock.agents || []).some(a => a.agent_name === 'chart_analyst')) {
      toast('该股未启用「技术分析」Agent，请先在持仓页为该股开启', 'info')
      return
    }
    setTriggering(true)
    try {
      const resp = await fetchAPI<{ result: AgentResult }>(`/stocks/${stock.id}/agents/chart_analyst/trigger?bypass_throttle=true`, { method: 'POST' })
      const r = resp?.result
      if (r) toast(r.should_alert ? 'AI 建议关注' : 'AI 判断无需关注', r.should_alert ? 'success' : 'info')
      await Promise.allSettled([loadSuggestions(), loadHistory()])
    } catch (e) {
      toast(e instanceof Error ? e.message : '触发失败', 'error')
    } finally {
      setTriggering(false)
    }
  }

  const badge = marketBadge(market)
  const changeColor = quote?.change_pct != null
    ? (quote.change_pct > 0 ? 'text-rose-500' : quote.change_pct < 0 ? 'text-emerald-500' : 'text-muted-foreground')
    : 'text-muted-foreground'

  const batchSuggestionItems = useMemo(() => {
    const items: Array<{ agent: string; record: HistoryRecord; suggestion: any }> = []
    for (const [agent, record] of Object.entries(batchReports)) {
      if (!record?.suggestions) continue
      const sug = (record.suggestions as any)[symbol]
      if (!sug) continue
      items.push({ agent, record, suggestion: sug })
    }
    return items
  }, [batchReports, symbol])

  if (!symbol) {
    return (
      <div className="card p-6">
        <div className="text-[13px] text-muted-foreground">无效的股票参数</div>
      </div>
    )
  }

  return (
    <div className="w-full space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 md:gap-3">
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => navigate(-1)} title="返回">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] px-2 py-0.5 rounded ${badge.style}`}>{badge.label}</span>
              <h1 className="text-lg md:text-xl font-bold">{resolvedName}</h1>
              <span className="font-mono text-[12px] text-muted-foreground">({symbol})</span>
            </div>
            <p className="text-[12px] md:text-[13px] text-muted-foreground">行情 · 建议 · 新闻 · 历史</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setKlineOpen(true)}>
            <BarChart3 className="w-3.5 h-3.5" />
            K线/指标
          </Button>
          <Button variant="secondary" size="sm" className="h-8 gap-1.5" onClick={triggerChartAnalyst} disabled={triggering}>
            <Sparkles className={`w-3.5 h-3.5 ${triggering ? 'animate-pulse' : ''}`} />
            技术分析
          </Button>
          <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={refreshAll} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <KlineSummaryDialog
        open={klineOpen}
        onOpenChange={setKlineOpen}
        symbol={symbol}
        market={market}
        stockName={stock?.name || quote?.name || symbol}
        hasPosition={false}
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        {[
          { value: 'overview' as const, label: '概览' },
          { value: 'suggestions' as const, label: `建议 (${suggestions.length})` },
          { value: 'news' as const, label: `新闻 (${news.length})` },
          { value: 'history' as const, label: `历史 (${history.length})` },
        ].map(t => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`text-[11px] px-2.5 py-1 rounded transition-colors ${
              tab === t.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-accent/50 text-muted-foreground hover:bg-accent'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Quote */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[13px] font-semibold text-foreground">实时行情</div>
              <span className="text-[11px] text-muted-foreground">{quote ? '来自行情源' : '暂无数据'}</span>
            </div>
            {!quote ? (
              <div className="text-[12px] text-muted-foreground py-6 text-center">暂无行情</div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-end justify-between gap-3">
                  <div className="text-[26px] font-bold font-mono text-foreground">
                    {quote.current_price != null ? formatNumber(quote.current_price) : '--'}
                  </div>
                  <div className={`text-[14px] font-mono ${changeColor}`}>
                    {quote.change_pct != null ? `${quote.change_pct >= 0 ? '+' : ''}${quote.change_pct.toFixed(2)}%` : '--'}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[12px]">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">昨收</span>
                    <span className="font-mono">{formatNumber(quote.prev_close)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">今开</span>
                    <span className="font-mono">{formatNumber(quote.open_price)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">最高</span>
                    <span className="font-mono">{formatNumber(quote.high_price)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">最低</span>
                    <span className="font-mono">{formatNumber(quote.low_price)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Suggestions */}
          <div className="card p-4 lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[13px] font-semibold text-foreground">最新建议</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIncludeExpired(v => !v)}
                  className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
                    includeExpired
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-accent/50 text-muted-foreground hover:bg-accent'
                  }`}
                >
                  {includeExpired ? '包含过期' : '不含过期'}
                </button>
                <Button variant="ghost" size="sm" className="h-7" onClick={() => setTab('suggestions')}>
                  查看全部
                </Button>
              </div>
            </div>

            {suggestions.length === 0 ? (
              <div className="text-[12px] text-muted-foreground py-6 text-center">暂无建议</div>
            ) : (
              <div className="space-y-3">
                {suggestions.slice(0, 3).map((s, idx) => (
                  <div key={`${s.agent_name || 's'}-${idx}`} className="p-3 rounded-lg bg-accent/20">
                    <SuggestionBadge suggestion={s} stockName={resolvedName} stockSymbol={symbol} showFullInline />
                  </div>
                ))}
              </div>
            )}

            {batchSuggestionItems.length > 0 && (
              <div className="mt-4 pt-4 border-t border-border/50">
                <div className="text-[12px] font-medium text-foreground mb-2">来自盘前/盘后/新闻的建议</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {batchSuggestionItems.map(({ agent, record, suggestion }) => (
                    <button
                      key={agent}
                      onClick={() => setDetailRecord(record)}
                      className="text-left p-3 rounded-lg bg-accent/20 hover:bg-accent/30 transition-colors"
                      title="点击查看报告全文"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="outline" className="text-[10px]">{AGENT_LABELS[agent] || agent}</Badge>
                        <span className="text-[10px] text-muted-foreground">{record.analysis_date}</span>
                      </div>
                      <div className="mt-2">
                        <SuggestionBadge
                          suggestion={{
                            action: suggestion.action,
                            action_label: suggestion.action_label,
                            signal: '',
                            reason: suggestion.reason || '',
                            should_alert: !!suggestion.should_alert,
                            agent_name: agent,
                            agent_label: AGENT_LABELS[agent] || agent,
                          }}
                          stockName={resolvedName}
                          stockSymbol={symbol}
                          showFullInline
                        />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* News quick */}
          <div className="card p-4 lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Newspaper className="w-4 h-4 text-muted-foreground" />
                <div className="text-[13px] font-semibold text-foreground">最新新闻</div>
              </div>
              <Button variant="ghost" size="sm" className="h-7" onClick={() => setTab('news')}>
                查看全部
              </Button>
            </div>
            {news.length === 0 ? (
              <div className="text-[12px] text-muted-foreground py-6 text-center">暂无相关新闻</div>
            ) : (
              <div className="space-y-2">
                {news.slice(0, 6).map((item, idx) => (
                  <div key={`${item.source}-${item.external_id}-${idx}`} className="p-3 rounded-lg hover:bg-accent/30 transition-colors">
                    <div className="flex items-start gap-2">
                      <Badge variant="outline" className={`text-[10px] flex-shrink-0 ${SOURCE_COLORS[item.source] || ''}`}>
                        {item.source_label}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        {item.url ? (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[12px] font-medium leading-snug line-clamp-2 hover:text-primary hover:underline inline-flex items-center gap-1"
                          >
                            {item.title}
                            <ExternalLink className="w-3 h-3 opacity-70" />
                          </a>
                        ) : (
                          <div className="text-[12px] font-medium leading-snug line-clamp-2">{item.title}</div>
                        )}
                        <div className="mt-1 text-[10px] text-muted-foreground flex items-center gap-2">
                          <span>{item.publish_time}</span>
                          {item.content && <span className="truncate">· {item.content}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* History quick */}
          <div className="card p-4 lg:col-span-1">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[13px] font-semibold text-foreground">最近历史</div>
              <Button variant="ghost" size="sm" className="h-7" onClick={() => setTab('history')}>
                查看全部
              </Button>
            </div>
            {history.length === 0 ? (
              <div className="text-[12px] text-muted-foreground py-6 text-center">暂无历史记录</div>
            ) : (
              <div className="space-y-2">
                {history.slice(0, 6).map(r => (
                  <button
                    key={r.id}
                    onClick={() => setDetailRecord(r)}
                    className="text-left p-3 rounded-lg bg-accent/20 hover:bg-accent/30 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="outline" className="text-[10px]">{AGENT_LABELS[r.agent_name] || r.agent_name}</Badge>
                      <span className="text-[10px] text-muted-foreground">{r.analysis_date}</span>
                    </div>
                    <div className="mt-1 text-[12px] text-foreground line-clamp-2">
                      {r.title || '分析报告'}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Suggestions tab */}
      {tab === 'suggestions' && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[13px] font-semibold text-foreground">建议列表</div>
            <button
              onClick={() => setIncludeExpired(v => !v)}
              className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
                includeExpired
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-accent/50 text-muted-foreground hover:bg-accent'
              }`}
            >
              {includeExpired ? '包含过期' : '不含过期'}
            </button>
          </div>
          {suggestions.length === 0 ? (
            <div className="text-[12px] text-muted-foreground py-10 text-center">暂无建议</div>
          ) : (
            <div className="space-y-3">
              {suggestions.map((s, idx) => (
                <div key={`${s.agent_name || 's'}-${idx}`} className="p-3 rounded-lg bg-accent/20">
                  <SuggestionBadge suggestion={s} stockName={resolvedName} stockSymbol={symbol} showFullInline />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* News tab */}
      {tab === 'news' && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Newspaper className="w-4 h-4 text-muted-foreground" />
              <div className="text-[13px] font-semibold text-foreground">新闻</div>
            </div>
            <div className="flex items-center gap-2">
              <Select value={newsHours} onValueChange={setNewsHours}>
                <SelectTrigger className="h-8 w-[120px] text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-[11px] text-muted-foreground">共 {news.length} 条</span>
            </div>
          </div>

          {news.length === 0 ? (
            <div className="text-[12px] text-muted-foreground py-10 text-center">暂无相关新闻</div>
          ) : (
            <div className="divide-y divide-border/50">
              {news.map((item, idx) => (
                <div key={`${item.source}-${item.external_id}-${idx}`} className="py-3">
                  <div className="flex items-start gap-3">
                    <Badge variant="outline" className={`text-[10px] flex-shrink-0 ${SOURCE_COLORS[item.source] || ''}`}>
                      {item.source_label}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        {item.url ? (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[13px] font-medium leading-snug hover:text-primary hover:underline"
                          >
                            {item.title}
                          </a>
                        ) : (
                          <div className="text-[13px] font-medium leading-snug">{item.title}</div>
                        )}
                        <span className="text-[11px] text-muted-foreground flex-shrink-0">{item.publish_time}</span>
                      </div>
                      {item.content && (
                        <div className="mt-1 text-[12px] text-muted-foreground line-clamp-3">
                          {item.content}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* History tab */}
      {tab === 'history' && (
        <div className="space-y-4">
          <div className="card p-4">
            <div className="text-[13px] font-semibold text-foreground mb-3">盘前 / 盘后 / 新闻报告（最新）</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {(['premarket_outlook', 'daily_report', 'news_digest'] as const).map(agent => {
                const rec = batchReports[agent]
                const sug = rec?.suggestions ? (rec.suggestions as any)[symbol] : null
                return (
                  <button
                    key={agent}
                    onClick={() => rec && setDetailRecord(rec)}
                    disabled={!rec}
                    className={`text-left p-3 rounded-lg border transition-colors ${
                      rec ? 'bg-accent/20 border-border/30 hover:bg-accent/30' : 'bg-accent/10 border-border/20 opacity-60 cursor-not-allowed'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="outline" className="text-[10px]">{AGENT_LABELS[agent]}</Badge>
                      <span className="text-[10px] text-muted-foreground">{rec?.analysis_date || '--'}</span>
                    </div>
                    {sug ? (
                      <div className="mt-2 text-[12px]">
                        <SuggestionBadge
                          suggestion={{
                            action: sug.action,
                            action_label: sug.action_label,
                            signal: '',
                            reason: sug.reason || '',
                            should_alert: !!sug.should_alert,
                            agent_name: agent,
                            agent_label: AGENT_LABELS[agent] || agent,
                          }}
                          stockName={resolvedName}
                          stockSymbol={symbol}
                          showFullInline
                        />
                      </div>
                    ) : (
                      <div className="mt-2 text-[12px] text-muted-foreground">
                        {rec ? '本次报告未给出该股建议' : '暂无记录'}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[13px] font-semibold text-foreground">个股历史记录</div>
              <span className="text-[11px] text-muted-foreground">共 {history.length} 条</span>
            </div>
            {history.length === 0 ? (
              <div className="text-[12px] text-muted-foreground py-10 text-center">暂无历史记录</div>
            ) : (
              <div className="space-y-2">
                {history.map(r => (
                  <button
                    key={r.id}
                    onClick={() => setDetailRecord(r)}
                    className="w-full text-left p-3 rounded-lg bg-accent/20 hover:bg-accent/30 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="outline" className="text-[10px]">{AGENT_LABELS[r.agent_name] || r.agent_name}</Badge>
                      <span className="text-[10px] text-muted-foreground">{r.analysis_date}</span>
                    </div>
                    <div className="mt-1 text-[12px] text-foreground line-clamp-2">{r.title || '分析报告'}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!detailRecord} onOpenChange={open => !open && setDetailRecord(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detailRecord?.title || '分析详情'}</DialogTitle>
            <DialogDescription>
              {detailRecord && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline">{AGENT_LABELS[detailRecord.agent_name] || detailRecord.agent_name}</Badge>
                  <span className="text-[11px] text-muted-foreground">{detailRecord.analysis_date}</span>
                  {detailRecord.created_at && (
                    <span className="text-[11px] text-muted-foreground">· {formatTime(detailRecord.created_at)}</span>
                  )}
                </div>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 p-4 bg-accent/20 rounded-lg prose prose-sm dark:prose-invert max-w-none">
            {detailRecord && <ReactMarkdown>{detailRecord.content}</ReactMarkdown>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
