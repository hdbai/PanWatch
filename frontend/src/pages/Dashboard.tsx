import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import {
  TrendingUp,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  PiggyBank,
  Plus,
  ChevronRight,
  Activity,
  BarChart3,
  Sparkles,
  Sun,
  Moon,
} from 'lucide-react'
import { fetchAPI, useLocalStorage } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Onboarding } from '@/components/onboarding'

interface MarketIndex {
  symbol: string
  name: string
  market: string
  current_price: number | null
  change_pct: number | null
  change_amount: number | null
  prev_close: number | null
}

interface MarketStatus {
  code: string
  name: string
  status: string
  status_text: string
  is_trading: boolean
  sessions: string[]
  local_time: string
}

interface PortfolioSummary {
  accounts: AccountSummary[]
  total: {
    total_market_value: number
    total_cost: number
    total_pnl: number
    total_pnl_pct: number
    available_funds: number
    total_assets: number
  }
}

interface AccountSummary {
  id: number
  name: string
  total_market_value: number
  total_pnl: number
  total_pnl_pct: number
}

interface SuggestionInfo {
  action: string  // buy/add/reduce/sell/hold/watch
  action_label: string
  signal: string
  reason: string
  should_alert: boolean
  raw?: string
}

interface KlineSummary {
  trend: string
  macd_status: string
  recent_5_up: number
  change_5d: number | null
  change_20d: number | null
  ma5: number | null
  ma10: number | null
  ma20: number | null
  support: number | null
  resistance: number | null
}

interface MonitorStock {
  symbol: string
  name: string
  market: string
  current_price: number
  change_pct: number
  open_price: number | null
  high_price: number | null
  low_price: number | null
  volume: number | null
  turnover: number | null
  alert_type: string | null
  has_position: boolean
  cost_price: number | null
  pnl_pct: number | null
  trading_style: string | null
  kline: KlineSummary | null
  suggestion: SuggestionInfo | null
}

interface Stock {
  id: number
  symbol: string
  name: string
  market: string
  enabled: boolean
}

interface StockQuote {
  current_price: number
  change_pct: number
}

interface AnalysisRecord {
  id: number
  agent_name: string
  stock_symbol: string
  analysis_date: string
  title: string
  content: string
  created_at: string
}

export default function DashboardPage() {
  const navigate = useNavigate()

  // Market indices
  const [indices, setIndices] = useState<MarketIndex[]>([])
  const [indicesLoading, setIndicesLoading] = useState(true)

  // Market status
  const [marketStatus, setMarketStatus] = useState<MarketStatus[]>([])

  // Portfolio
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null)
  const [portfolioLoading, setPortfolioLoading] = useState(false)
  const hasPortfolio = portfolio && portfolio.accounts.length > 0

  // Watchlist
  const [stocks, setStocks] = useState<Stock[]>([])
  const [quotes, setQuotes] = useState<Record<string, StockQuote>>({})
  const hasWatchlist = stocks.filter(s => s.enabled).length > 0

  // Monitor stocks
  const [monitorStocks, setMonitorStocks] = useState<MonitorStock[]>([])
  const [availableFunds, setAvailableFunds] = useState<number>(0)
  const [scanning, setScanning] = useState(false)
  const [enableAIAnalysis, setEnableAIAnalysis] = useState(true)

  // Auto-refresh (持久化到 localStorage)
  const [autoRefresh, setAutoRefresh] = useLocalStorage('panwatch_dashboard_autoRefresh', false)
  const [refreshInterval, setRefreshInterval] = useLocalStorage('panwatch_dashboard_refreshInterval', 30)
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setInterval>>()

  // Onboarding
  const [showOnboarding, setShowOnboarding] = useState(false)

  // AI Insights
  const [dailyReport, setDailyReport] = useState<AnalysisRecord | null>(null)
  const [premarketOutlook, setPremarketOutlook] = useState<AnalysisRecord | null>(null)
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [expandedInsight, setExpandedInsight] = useState<string | null>(null)

  // Initial load
  useEffect(() => {
    loadIndices()
    loadMarketStatus()
    loadPortfolio()
    loadWatchlist()
    loadAIInsights()

    // Check if onboarding should be shown
    const onboardingCompleted = localStorage.getItem('panwatch_onboarding_completed')
    if (!onboardingCompleted) {
      setShowOnboarding(true)
    }
  }, [])

  // Auto-refresh timer
  useEffect(() => {
    if (autoRefresh) {
      scanAlerts()
      refreshTimerRef.current = setInterval(() => {
        handleRefresh()
      }, refreshInterval * 1000)
    } else {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current)
        refreshTimerRef.current = undefined
      }
    }

    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current)
      }
    }
  }, [autoRefresh, refreshInterval])

  const loadIndices = async () => {
    setIndicesLoading(true)
    try {
      const data = await fetchAPI<MarketIndex[]>('/market/indices')
      setIndices(data)
    } catch (e) {
      console.error('获取指数失败:', e)
    } finally {
      setIndicesLoading(false)
    }
  }

  const loadMarketStatus = async () => {
    try {
      const data = await fetchAPI<MarketStatus[]>('/stocks/markets/status')
      setMarketStatus(data)
    } catch (e) {
      console.error('获取市场状态失败:', e)
    }
  }

  const loadPortfolio = async () => {
    setPortfolioLoading(true)
    try {
      const data = await fetchAPI<PortfolioSummary>('/portfolio/summary')
      setPortfolio(data)
    } catch (e) {
      console.error('获取持仓失败:', e)
    } finally {
      setPortfolioLoading(false)
    }
  }

  const loadWatchlist = async () => {
    try {
      const [stocksData, quotesData] = await Promise.all([
        fetchAPI<Stock[]>('/stocks'),
        fetchAPI<Record<string, StockQuote>>('/stocks/quotes'),
      ])
      setStocks(stocksData)
      setQuotes(quotesData)
    } catch (e) {
      console.error('获取自选股失败:', e)
    }
  }

  const loadAIInsights = async () => {
    setInsightsLoading(true)
    try {
      const [dailyData, premarketData] = await Promise.all([
        fetchAPI<AnalysisRecord[]>('/history?agent_name=daily_report&limit=1'),
        fetchAPI<AnalysisRecord[]>('/history?agent_name=premarket_outlook&limit=1'),
      ])
      setDailyReport(dailyData.length > 0 ? dailyData[0] : null)
      setPremarketOutlook(premarketData.length > 0 ? premarketData[0] : null)
    } catch (e) {
      console.error('获取 AI 洞察失败:', e)
    } finally {
      setInsightsLoading(false)
    }
  }

  const scanAlerts = useCallback(async () => {
    if (!hasWatchlist) return

    setScanning(true)
    try {
      const url = enableAIAnalysis ? '/agents/intraday/scan?analyze=true' : '/agents/intraday/scan'
      const result = await fetchAPI<{ stocks: MonitorStock[]; available_funds: number }>(url, { method: 'POST' })
      setMonitorStocks(result.stocks || [])
      setAvailableFunds(result.available_funds || 0)
      setLastRefreshTime(new Date())
    } catch (e) {
      console.error('扫描失败:', e)
    } finally {
      setScanning(false)
    }
  }, [hasWatchlist, enableAIAnalysis])

  const handleRefresh = useCallback(async () => {
    await Promise.all([
      loadIndices(),
      loadPortfolio(),
      loadWatchlist(),
      loadAIInsights(),
      scanAlerts(),
    ])
    setLastRefreshTime(new Date())
  }, [scanAlerts])

  const formatMoney = (value: number) => {
    if (Math.abs(value) >= 10000) {
      return `${(value / 10000).toFixed(2)}万`
    }
    return value.toFixed(2)
  }

  const formatIndexPrice = (value: number | null) => {
    if (value === null) return '--'
    if (value >= 10000) {
      return value.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    }
    return value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  }

  const marketBadge = (m: string) => {
    if (m === 'HK') return { style: 'bg-orange-500/10 text-orange-600', label: '港' }
    if (m === 'US') return { style: 'bg-green-500/10 text-green-600', label: '美' }
    return { style: 'bg-blue-500/10 text-blue-600', label: 'A' }
  }

  const handleOnboardingComplete = () => {
    localStorage.setItem('panwatch_onboarding_completed', 'true')
    setShowOnboarding(false)
    // Reload data in case sample stocks were added
    loadWatchlist()
  }

  return (
    <div>
      {/* Onboarding */}
      <Onboarding
        open={showOnboarding}
        onComplete={handleOnboardingComplete}
        hasStocks={hasWatchlist}
      />

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-[20px] md:text-[22px] font-bold text-foreground tracking-tight">Dashboard</h1>
          <div className="flex items-center gap-2 md:gap-3 mt-1.5 flex-wrap">
            {marketStatus.map(m => {
              const statusColors: Record<string, string> = {
                trading: 'bg-emerald-500',
                pre_market: 'bg-amber-500',
                break: 'bg-amber-500',
                after_hours: 'bg-slate-400',
                closed: 'bg-slate-400',
              }
              return (
                <div
                  key={m.code}
                  className="flex items-center gap-1"
                  title={`${m.sessions.join(', ')} (${m.local_time})`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${statusColors[m.status] || 'bg-slate-400'}`} />
                  <span className="text-[11px] md:text-[12px] text-muted-foreground">{m.name}</span>
                  <span className={`text-[10px] md:text-[11px] ${m.is_trading ? 'text-emerald-600' : 'text-muted-foreground/60'}`}>
                    {m.status_text}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Auto Refresh & AI Analysis Controls */}
          <div className="flex items-center gap-2 md:gap-3 px-2 md:px-3 py-1.5 rounded-lg bg-accent/30">
            <div className="flex items-center gap-1 md:gap-1.5">
              <Switch
                checked={autoRefresh}
                onCheckedChange={setAutoRefresh}
                className="scale-90"
              />
              <span className="text-[11px] md:text-[12px] text-muted-foreground hidden sm:inline">自动刷新</span>
              {autoRefresh && (
                <Select value={refreshInterval.toString()} onValueChange={v => setRefreshInterval(parseInt(v))}>
                  <SelectTrigger className="h-6 w-14 md:w-16 text-[10px] md:text-[11px] px-1.5 md:px-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10s</SelectItem>
                    <SelectItem value="30">30s</SelectItem>
                    <SelectItem value="60">1分钟</SelectItem>
                    <SelectItem value="120">2分钟</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="w-px h-4 bg-border hidden sm:block" />
            <div className="flex items-center gap-1 md:gap-1.5">
              <Switch
                checked={enableAIAnalysis}
                onCheckedChange={setEnableAIAnalysis}
                className="scale-90"
              />
              <span className="text-[11px] md:text-[12px] text-muted-foreground hidden sm:inline">AI 建议</span>
            </div>
            {lastRefreshTime && (
              <span className="text-[9px] md:text-[10px] text-muted-foreground/60 hidden md:inline">
                {lastRefreshTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
          </div>
          <Button variant="secondary" size="sm" onClick={handleRefresh} disabled={portfolioLoading || scanning || indicesLoading} className="h-8 md:h-9 px-2.5 md:px-3">
            <RefreshCw className={`w-4 h-4 ${portfolioLoading || scanning || indicesLoading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">刷新</span>
          </Button>
        </div>
      </div>

      {/* Portfolio Summary Cards */}
      {hasPortfolio && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="card p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <PiggyBank className="w-4 h-4" />
              <span className="text-[12px]">总资产</span>
            </div>
            <div className="text-[20px] font-bold text-foreground font-mono">
              {formatMoney(portfolio!.total.total_assets)}
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              {portfolio!.total.total_pnl >= 0 ? (
                <ArrowUpRight className="w-4 h-4 text-rose-500" />
              ) : (
                <ArrowDownRight className="w-4 h-4 text-emerald-500" />
              )}
              <span className="text-[12px]">总盈亏</span>
            </div>
            <div className={`text-[20px] font-bold font-mono ${portfolio!.total.total_pnl >= 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
              {portfolio!.total.total_pnl >= 0 ? '+' : ''}{formatMoney(portfolio!.total.total_pnl)}
              <span className="text-[13px] ml-1.5">
                ({portfolio!.total.total_pnl_pct >= 0 ? '+' : ''}{portfolio!.total.total_pnl_pct.toFixed(2)}%)
              </span>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <TrendingUp className="w-4 h-4" />
              <span className="text-[12px]">持仓市值</span>
            </div>
            <div className="text-[20px] font-bold text-foreground font-mono">
              {formatMoney(portfolio!.total.total_market_value)}
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Wallet className="w-4 h-4" />
              <span className="text-[12px]">可用资金</span>
            </div>
            <div className="text-[20px] font-bold text-foreground font-mono">
              {formatMoney(portfolio!.total.available_funds)}
            </div>
          </div>
        </div>
      )}

      {/* Market Indices */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[15px] font-semibold text-foreground flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            大盘指数
          </h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {indicesLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="card p-3 animate-pulse">
                <div className="h-4 bg-accent/50 rounded w-16 mb-2" />
                <div className="h-6 bg-accent/50 rounded w-20 mb-1" />
                <div className="h-3 bg-accent/30 rounded w-12" />
              </div>
            ))
          ) : (
            indices.map(idx => {
              const isUp = idx.change_pct !== null && idx.change_pct > 0
              const isDown = idx.change_pct !== null && idx.change_pct < 0
              const changeColor = isUp ? 'text-rose-500' : isDown ? 'text-emerald-500' : 'text-muted-foreground'
              const bgColor = isUp ? 'bg-rose-500/5' : isDown ? 'bg-emerald-500/5' : 'bg-accent/30'

              return (
                <div key={idx.symbol} className={`card p-3 ${bgColor} border-0`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`text-[9px] px-1 py-0.5 rounded ${marketBadge(idx.market).style}`}>
                      {marketBadge(idx.market).label}
                    </span>
                    <span className="text-[12px] text-muted-foreground">{idx.name}</span>
                  </div>
                  <div className={`text-[18px] font-bold font-mono ${changeColor}`}>
                    {formatIndexPrice(idx.current_price)}
                  </div>
                  <div className={`text-[12px] font-mono ${changeColor}`}>
                    {idx.change_pct !== null ? (
                      <>
                        {isUp ? '+' : ''}{idx.change_pct.toFixed(2)}%
                        <span className="ml-1.5 opacity-60">
                          {isUp ? '+' : ''}{idx.change_amount?.toFixed(2)}
                        </span>
                      </>
                    ) : (
                      '--'
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Intraday Monitor */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[15px] font-semibold text-foreground flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            盘中监控
            {monitorStocks.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">{monitorStocks.length} 只</Badge>
            )}
            {availableFunds > 0 && (
              <span className="text-[11px] text-muted-foreground ml-2">
                可用: ¥{formatMoney(availableFunds)}
              </span>
            )}
          </h2>
          {hasWatchlist && (
            <Button variant="ghost" size="sm" onClick={scanAlerts} disabled={scanning} className="h-7 text-[12px]">
              {scanning ? (
                <span className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              刷新
            </Button>
          )}
        </div>

        {!hasWatchlist ? (
          <div className="card p-6 text-center">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
              <Activity className="w-5 h-5 text-primary" />
            </div>
            <p className="text-[14px] font-medium text-foreground mb-1">启用盘中监控</p>
            <p className="text-[12px] text-muted-foreground mb-4">为股票启用「盘中监测」Agent 后可查看实时分析</p>
            <Button size="sm" onClick={() => navigate('/portfolio')}>
              <Plus className="w-4 h-4" /> 添加自选股
            </Button>
          </div>
        ) : monitorStocks.length === 0 ? (
          <div className="card p-6 text-center">
            <p className="text-[13px] text-muted-foreground">点击刷新获取监控数据</p>
          </div>
        ) : (
          <div className="space-y-3">
            {monitorStocks.map(stock => {
              const actionColors: Record<string, string> = {
                buy: 'bg-rose-500 text-white',
                add: 'bg-rose-400 text-white',
                reduce: 'bg-emerald-500 text-white',
                sell: 'bg-emerald-600 text-white',
                hold: 'bg-amber-500 text-white',
                watch: 'bg-slate-500 text-white',
              }
              const styleLabels: Record<string, string> = { short: '短线', swing: '波段', long: '长线' }
              const changeColor = stock.change_pct > 0 ? 'text-rose-500' : stock.change_pct < 0 ? 'text-emerald-500' : 'text-muted-foreground'
              const suggestion = stock.suggestion

              return (
                <div key={stock.symbol} className="card p-4">
                  {/* Header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[13px] font-semibold text-foreground">{stock.symbol}</span>
                      <span className="text-[12px] text-muted-foreground">{stock.name}</span>
                      {stock.alert_type && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          stock.alert_type === '急涨' ? 'bg-rose-500/10 text-rose-500' : 'bg-emerald-500/10 text-emerald-500'
                        }`}>
                          {stock.alert_type}
                        </span>
                      )}
                      {stock.has_position && stock.trading_style && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                          {styleLabels[stock.trading_style] || '波段'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className={`font-mono text-[14px] font-medium ${changeColor}`}>
                          {stock.current_price?.toFixed(2) || '--'}
                        </div>
                        <div className={`font-mono text-[11px] ${changeColor}`}>
                          {stock.change_pct >= 0 ? '+' : ''}{stock.change_pct?.toFixed(2) || '0.00'}%
                        </div>
                      </div>
                      {stock.has_position && stock.pnl_pct != null && (
                        <div className="text-right min-w-[60px]">
                          <div className="text-[10px] text-muted-foreground">盈亏</div>
                          <div className={`font-mono text-[13px] font-medium ${stock.pnl_pct >= 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                            {stock.pnl_pct >= 0 ? '+' : ''}{stock.pnl_pct.toFixed(2)}%
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Technical Info */}
                  {stock.kline && (
                    <div className="flex flex-wrap gap-2 mb-3 text-[11px]">
                      <span className="px-2 py-0.5 rounded bg-accent/50 text-muted-foreground">
                        {stock.kline.trend}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-accent/50 text-muted-foreground">
                        {stock.kline.macd_status}
                      </span>
                      {stock.kline.support && (
                        <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600">
                          支撑 {stock.kline.support.toFixed(2)}
                        </span>
                      )}
                      {stock.kline.resistance && (
                        <span className="px-2 py-0.5 rounded bg-rose-500/10 text-rose-600">
                          压力 {stock.kline.resistance.toFixed(2)}
                        </span>
                      )}
                    </div>
                  )}

                  {/* AI Suggestion */}
                  {suggestion && (
                    <div className="pt-3 border-t border-border/30">
                      <div className="flex items-start gap-3">
                        <span className={`text-[11px] px-2 py-1 rounded font-medium ${actionColors[suggestion.action] || 'bg-slate-500 text-white'}`}>
                          {suggestion.action_label}
                        </span>
                        <div className="flex-1 min-w-0">
                          {suggestion.signal && (
                            <p className="text-[12px] font-medium text-foreground mb-0.5">{suggestion.signal}</p>
                          )}
                          {suggestion.reason && (
                            <p className="text-[11px] text-muted-foreground">{suggestion.reason}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* AI Insights */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[15px] font-semibold text-foreground flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            AI 洞察
          </h2>
          {(dailyReport || premarketOutlook) && (
            <button
              onClick={() => navigate('/history')}
              className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-primary transition-colors"
            >
              查看更多 <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>

        {insightsLoading ? (
          <div className="card p-4 animate-pulse">
            <div className="h-4 bg-accent/50 rounded w-32 mb-3" />
            <div className="h-3 bg-accent/30 rounded w-full mb-2" />
            <div className="h-3 bg-accent/30 rounded w-3/4" />
          </div>
        ) : !dailyReport && !premarketOutlook ? (
          <div className="card p-6 text-center">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <p className="text-[14px] font-medium text-foreground mb-1">暂无 AI 分析</p>
            <p className="text-[12px] text-muted-foreground mb-4">配置 AI 服务后，启用盘后日报或盘前分析 Agent</p>
            <Button variant="secondary" size="sm" onClick={() => navigate('/agents')}>
              配置 Agent
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 盘后日报 */}
            {dailyReport && (
              <div
                className="card p-4 cursor-pointer hover:bg-accent/30 transition-colors"
                onClick={() => setExpandedInsight(expandedInsight === 'daily' ? null : 'daily')}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
                    <Moon className="w-4 h-4 text-orange-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-foreground">盘后日报</span>
                      <span className="text-[11px] text-muted-foreground">{dailyReport.analysis_date}</span>
                    </div>
                    {dailyReport.title && (
                      <p className="text-[12px] text-muted-foreground truncate">{dailyReport.title}</p>
                    )}
                  </div>
                  <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${expandedInsight === 'daily' ? 'rotate-90' : ''}`} />
                </div>
                {expandedInsight === 'daily' && (
                  <div className="mt-3 pt-3 border-t border-border/30">
                    <div className="prose prose-sm dark:prose-invert max-w-none max-h-[300px] overflow-y-auto text-[12px]">
                      <ReactMarkdown>{dailyReport.content}</ReactMarkdown>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate('/history') }}
                      className="mt-3 text-[11px] text-primary hover:underline"
                    >
                      查看历史记录
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 盘前分析 */}
            {premarketOutlook && (
              <div
                className="card p-4 cursor-pointer hover:bg-accent/30 transition-colors"
                onClick={() => setExpandedInsight(expandedInsight === 'premarket' ? null : 'premarket')}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                    <Sun className="w-4 h-4 text-amber-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-foreground">盘前分析</span>
                      <span className="text-[11px] text-muted-foreground">{premarketOutlook.analysis_date}</span>
                    </div>
                    {premarketOutlook.title && (
                      <p className="text-[12px] text-muted-foreground truncate">{premarketOutlook.title}</p>
                    )}
                  </div>
                  <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${expandedInsight === 'premarket' ? 'rotate-90' : ''}`} />
                </div>
                {expandedInsight === 'premarket' && (
                  <div className="mt-3 pt-3 border-t border-border/30">
                    <div className="prose prose-sm dark:prose-invert max-w-none max-h-[300px] overflow-y-auto text-[12px]">
                      <ReactMarkdown>{premarketOutlook.content}</ReactMarkdown>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate('/history') }}
                      className="mt-3 text-[11px] text-primary hover:underline"
                    >
                      查看历史记录
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Watchlist Quick View */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[15px] font-semibold text-foreground flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            自选股快览
          </h2>
          {hasWatchlist && (
            <button
              onClick={() => navigate('/portfolio')}
              className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-primary transition-colors"
            >
              查看全部 <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>

        {!hasWatchlist ? (
          <div className="card p-6 md:p-8 text-center">
            <div className="w-12 md:w-14 h-12 md:h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3 md:mb-4">
              <TrendingUp className="w-5 md:w-6 h-5 md:h-6 text-primary" />
            </div>
            <p className="text-[15px] font-medium text-foreground mb-1">还没有添加自选股</p>
            <p className="text-[13px] text-muted-foreground mb-4">添加股票后，这里会显示实时行情和异动提醒</p>
            <div className="flex items-center justify-center gap-3">
              <Button onClick={() => navigate('/portfolio')}>
                <Plus className="w-4 h-4" /> 添加第一只股票
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {stocks.filter(s => s.enabled).slice(0, 12).map(stock => {
              const quote = quotes[stock.symbol]
              const isUp = quote?.change_pct != null && quote.change_pct > 0
              const isDown = quote?.change_pct != null && quote.change_pct < 0
              const changeColor = isUp ? 'text-rose-500' : isDown ? 'text-emerald-500' : 'text-muted-foreground'
              const bgColor = isUp ? 'bg-rose-500/5' : isDown ? 'bg-emerald-500/5' : 'bg-accent/30'

              return (
                <div
                  key={stock.id}
                  className={`card p-3 ${bgColor} border-0 cursor-pointer hover:opacity-80 transition-opacity`}
                  onClick={() => navigate('/portfolio')}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`text-[9px] px-1 py-0.5 rounded ${marketBadge(stock.market).style}`}>
                      {marketBadge(stock.market).label}
                    </span>
                    <span className="text-[11px] text-muted-foreground truncate">{stock.name}</span>
                  </div>
                  <div className={`text-[16px] font-bold font-mono ${changeColor}`}>
                    {quote?.current_price?.toFixed(2) || '--'}
                  </div>
                  <div className={`text-[11px] font-mono ${changeColor}`}>
                    {quote?.change_pct != null ? (
                      `${isUp ? '+' : ''}${quote.change_pct.toFixed(2)}%`
                    ) : (
                      '--'
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Empty Portfolio Hint */}
      {!hasPortfolio && hasWatchlist && (
        <div className="card p-6 text-center border-dashed">
          <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center mx-auto mb-3">
            <Wallet className="w-5 h-5 text-blue-500" />
          </div>
          <p className="text-[14px] font-medium text-foreground mb-1">添加持仓查看盈亏</p>
          <p className="text-[12px] text-muted-foreground mb-4">记录你的持仓成本，系统会自动计算盈亏情况</p>
          <Button variant="secondary" size="sm" onClick={() => navigate('/portfolio')}>
            管理持仓
          </Button>
        </div>
      )}
    </div>
  )
}
