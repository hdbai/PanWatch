import { useState, useEffect, useRef } from 'react'
import { Plus, Trash2, Pencil, Search, X, TrendingUp, Bot, Play, Clock, Cpu, Bell, RefreshCw } from 'lucide-react'
import { fetchAPI, type AIService, type NotifyChannel } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'

interface StockAgentInfo {
  agent_name: string
  schedule: string
  ai_model_id: number | null
  notify_channel_ids: number[]
}

interface Stock {
  id: number
  symbol: string
  name: string
  market: string
  cost_price: number | null
  quantity: number | null
  enabled: boolean
  agents: StockAgentInfo[]
}

interface AgentConfig {
  name: string
  display_name: string
  description: string
  enabled: boolean
  schedule: string
}

interface SearchResult {
  symbol: string
  name: string
  market: string
}

interface QuoteData {
  current_price: number
  change_pct: number
  change_amount: number
  prev_close: number
}

interface StockForm {
  symbol: string
  name: string
  market: string
  cost_price: string
  quantity: string
}

const emptyForm: StockForm = {
  symbol: '', name: '', market: 'CN',
  cost_price: '', quantity: '',
}

export default function StocksPage() {
  const [stocks, setStocks] = useState<Stock[]>([])
  const [agents, setAgents] = useState<AgentConfig[]>([])
  const [services, setServices] = useState<AIService[]>([])
  const [channels, setChannels] = useState<NotifyChannel[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<StockForm>(emptyForm)
  const [editId, setEditId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [searching, setSearching] = useState(false)
  const [quotes, setQuotes] = useState<Record<string, QuoteData>>({})
  const [quotesLoading, setQuotesLoading] = useState(false)
  const [agentDialogStock, setAgentDialogStock] = useState<Stock | null>(null)
  const [triggeringAgent, setTriggeringAgent] = useState<string | null>(null)
  const [scheduleEdits, setScheduleEdits] = useState<Record<string, string>>({})
  const { toast } = useToast()
  const searchTimer = useRef<ReturnType<typeof setTimeout>>()
  const dropdownRef = useRef<HTMLDivElement>(null)

  const load = async () => {
    try {
      const [stockData, agentData, servicesData, channelData] = await Promise.all([
        fetchAPI<Stock[]>('/stocks'),
        fetchAPI<AgentConfig[]>('/agents'),
        fetchAPI<AIService[]>('/providers/services'),
        fetchAPI<NotifyChannel[]>('/channels'),
      ])
      setStocks(stockData)
      setAgents(agentData)
      setServices(servicesData)
      setChannels(channelData)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const loadQuotes = async () => {
    setQuotesLoading(true)
    try {
      const data = await fetchAPI<Record<string, QuoteData>>('/stocks/quotes')
      setQuotes(data)
    } catch (e) {
      console.error(e)
    } finally {
      setQuotesLoading(false)
    }
  }

  useEffect(() => { load(); loadQuotes() }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const doSearch = async (q: string) => {
    if (q.length < 1) { setSearchResults([]); setShowDropdown(false); return }
    setSearching(true)
    try {
      const results = await fetchAPI<SearchResult[]>(`/stocks/search?q=${encodeURIComponent(q)}`)
      setSearchResults(results)
      setShowDropdown(results.length > 0)
    } catch { setSearchResults([]) }
    finally { setSearching(false) }
  }

  const handleSearchInput = (value: string) => {
    setSearchQuery(value)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => doSearch(value), 300)
  }

  const selectStock = (item: SearchResult) => {
    setForm({ ...form, symbol: item.symbol, name: item.name, market: item.market })
    setSearchQuery(`${item.symbol} ${item.name}`)
    setShowDropdown(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload = {
      symbol: form.symbol, name: form.name, market: form.market,
      cost_price: form.cost_price ? parseFloat(form.cost_price) : null,
      quantity: form.quantity ? parseInt(form.quantity) : null,
    }
    if (editId) {
      await fetchAPI(`/stocks/${editId}`, { method: 'PUT', body: JSON.stringify(payload) })
    } else {
      await fetchAPI('/stocks', { method: 'POST', body: JSON.stringify(payload) })
    }
    setForm(emptyForm); setSearchQuery(''); setShowForm(false); setEditId(null); load()
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除？')) return
    await fetchAPI(`/stocks/${id}`, { method: 'DELETE' }); load()
  }

  const handleEdit = (stock: Stock) => {
    setForm({
      symbol: stock.symbol, name: stock.name, market: stock.market,
      cost_price: stock.cost_price?.toString() || '', quantity: stock.quantity?.toString() || '',
    })
    setEditId(stock.id); setSearchQuery(`${stock.symbol} ${stock.name}`); setShowForm(true)
  }

  const toggleEnabled = async (stock: Stock) => {
    await fetchAPI(`/stocks/${stock.id}`, { method: 'PUT', body: JSON.stringify({ enabled: !stock.enabled }) })
    load()
  }

  const toggleAgent = async (stock: Stock, agentName: string) => {
    const current = stock.agents || []
    const isAssigned = current.some(a => a.agent_name === agentName)
    const newAgents = isAssigned
      ? current.filter(a => a.agent_name !== agentName)
      : [...current, { agent_name: agentName, schedule: '', ai_model_id: null, notify_channel_ids: [] }]
    await fetchAPI(`/stocks/${stock.id}/agents`, { method: 'PUT', body: JSON.stringify({ agents: newAgents }) })
    load()
    setAgentDialogStock(prev => prev ? { ...prev, agents: newAgents } : null)
  }

  const updateSchedule = async (stock: Stock, agentName: string, schedule: string) => {
    const newAgents = (stock.agents || []).map(a =>
      a.agent_name === agentName ? { ...a, schedule } : a
    )
    await fetchAPI(`/stocks/${stock.id}/agents`, { method: 'PUT', body: JSON.stringify({ agents: newAgents }) })
    load()
    setAgentDialogStock(prev => prev ? { ...prev, agents: newAgents } : null)
  }

  const updateStockAgentModel = async (stock: Stock, agentName: string, modelId: number | null) => {
    const newAgents = (stock.agents || []).map(a =>
      a.agent_name === agentName ? { ...a, ai_model_id: modelId } : a
    )
    await fetchAPI(`/stocks/${stock.id}/agents`, { method: 'PUT', body: JSON.stringify({ agents: newAgents }) })
    load()
    setAgentDialogStock(prev => prev ? { ...prev, agents: newAgents } : null)
  }

  const toggleStockAgentChannel = async (stock: Stock, agentName: string, channelId: number) => {
    const newAgents = (stock.agents || []).map(a => {
      if (a.agent_name !== agentName) return a
      const current = a.notify_channel_ids || []
      const newIds = current.includes(channelId)
        ? current.filter(id => id !== channelId)
        : [...current, channelId]
      return { ...a, notify_channel_ids: newIds }
    })
    await fetchAPI(`/stocks/${stock.id}/agents`, { method: 'PUT', body: JSON.stringify({ agents: newAgents }) })
    load()
    setAgentDialogStock(prev => prev ? { ...prev, agents: newAgents } : null)
  }

  const triggerStockAgent = async (stockId: number, agentName: string) => {
    setTriggeringAgent(agentName)
    try {
      await fetchAPI(`/stocks/${stockId}/agents/${agentName}/trigger`, { method: 'POST' })
      toast('Agent 已触发', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : '触发失败', 'error')
    } finally {
      setTriggeringAgent(null)
    }
  }

  const marketLabel = (m: string) => m === 'CN' ? 'A股' : m === 'HK' ? '港股' : m

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[22px] font-bold text-foreground tracking-tight">自选股</h1>
          <p className="text-[13px] text-muted-foreground mt-1">管理关注的股票和监控策略</p>
        </div>
        <Button onClick={() => { setForm(emptyForm); setEditId(null); setSearchQuery(''); setShowForm(true) }}>
          <Plus className="w-4 h-4" /> 添加股票
        </Button>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div className="mb-8 card p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-[15px] font-semibold text-foreground">{editId ? '编辑股票' : '添加股票'}</h3>
            <Button variant="ghost" size="icon" onClick={() => { setShowForm(false); setSearchQuery('') }}>
              <X className="w-4 h-4" />
            </Button>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="relative" ref={dropdownRef}>
                <Label>搜索股票</Label>
                <div className="relative">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                  <Input
                    value={searchQuery}
                    onChange={e => handleSearchInput(e.target.value)}
                    onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                    placeholder="代码或名称，如 600519 或 茅台"
                    className="pl-10"
                    disabled={!!editId}
                    autoComplete="off"
                  />
                  {searching && <span className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />}
                </div>
                {showDropdown && (
                  <div className="absolute z-50 w-full mt-2 max-h-64 overflow-auto card shadow-[0_8px_30px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.04)]">
                    {searchResults.map(item => (
                      <button
                        key={`${item.market}-${item.symbol}`}
                        type="button"
                        onClick={() => selectStock(item)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-[13px] hover:bg-accent/50 text-left transition-colors first:rounded-t-2xl last:rounded-b-2xl"
                      >
                        <span className="font-mono text-muted-foreground text-[12px] w-14">{item.symbol}</span>
                        <span className="flex-1 font-medium text-foreground">{item.name}</span>
                        <Badge variant="secondary">{marketLabel(item.market)}</Badge>
                      </button>
                    ))}
                  </div>
                )}
                {form.symbol && (
                  <div className="mt-2.5 flex items-center gap-2">
                    <Badge><span className="font-mono">{form.symbol}</span> {form.name}</Badge>
                    <Badge variant="secondary">{marketLabel(form.market)}</Badge>
                  </div>
                )}
              </div>
              <div>
                <Label>成本价</Label>
                <Input value={form.cost_price} onChange={e => setForm({ ...form, cost_price: e.target.value })} placeholder="选填" className="font-mono" inputMode="decimal" />
              </div>
              <div>
                <Label>持仓数量</Label>
                <Input value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} placeholder="选填" className="font-mono" inputMode="numeric" />
              </div>
            </div>
            <div className="mt-6 flex items-center gap-3">
              <Button type="submit" disabled={!form.symbol}>{editId ? '保存修改' : '确认添加'}</Button>
              <Button type="button" variant="ghost" onClick={() => { setShowForm(false); setSearchQuery('') }}>取消</Button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : stocks.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-20">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/10 to-[hsl(260,70%,55%)]/10 flex items-center justify-center mb-4">
            <TrendingUp className="w-6 h-6 text-primary" />
          </div>
          <p className="text-[15px] font-semibold text-foreground">还没有自选股</p>
          <p className="text-[13px] text-muted-foreground mt-1.5">点击上方"添加股票"开始管理你的关注列表</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-end px-4 py-2 border-b border-border/30">
            <Button variant="ghost" size="sm" onClick={loadQuotes} disabled={quotesLoading}>
              <RefreshCw className={`w-3.5 h-3.5 ${quotesLoading ? 'animate-spin' : ''}`} />
              刷新行情
            </Button>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">代码</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">名称</th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">现价</th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">涨跌</th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">成本</th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">持仓</th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">盈亏</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Agent</th>
                <th className="text-center px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">状态</th>
                <th className="text-center px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody>
              {stocks.map((stock, i) => {
                const quote = quotes[stock.symbol]
                const hasPosition = stock.cost_price != null && stock.quantity != null
                const pnl = hasPosition && quote ? (quote.current_price - stock.cost_price!) * stock.quantity! : null
                const pnlPct = hasPosition && quote && stock.cost_price ? ((quote.current_price - stock.cost_price) / stock.cost_price * 100) : null
                const changeColor = quote ? (quote.change_pct > 0 ? 'text-rose-500' : quote.change_pct < 0 ? 'text-emerald-500' : 'text-muted-foreground') : 'text-muted-foreground'
                const pnlColor = pnl != null ? (pnl > 0 ? 'text-rose-500' : pnl < 0 ? 'text-emerald-500' : 'text-muted-foreground') : 'text-muted-foreground'
                return (
                  <tr key={stock.id} className={`group hover:bg-accent/30 transition-colors ${i > 0 ? 'border-t border-border/30' : ''}`}>
                    <td className="px-4 py-3">
                      <span className="font-mono text-[12px] font-semibold text-foreground">{stock.symbol}</span>
                      <span className="ml-1.5 text-[10px] text-muted-foreground">{stock.market === 'HK' ? '港' : ''}</span>
                    </td>
                    <td className="px-4 py-3 text-[13px] font-medium text-foreground">{stock.name}</td>
                    <td className={`px-4 py-3 text-right font-mono text-[12px] font-medium ${changeColor}`}>
                      {quote ? quote.current_price.toFixed(2) : '—'}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono text-[12px] ${changeColor}`}>
                      {quote ? `${quote.change_pct >= 0 ? '+' : ''}${quote.change_pct.toFixed(2)}%` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[12px] text-muted-foreground">{stock.cost_price?.toFixed(2) || '—'}</td>
                    <td className="px-4 py-3 text-right font-mono text-[12px] text-muted-foreground">{stock.quantity || '—'}</td>
                    <td className={`px-4 py-3 text-right font-mono text-[12px] ${pnlColor}`}>
                      {pnl != null ? (
                        <span title={`${pnl >= 0 ? '+' : ''}${pnl.toFixed(0)}元`}>
                          {pnlPct != null ? `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%` : '—'}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => { setAgentDialogStock(stock); setScheduleEdits({}) }}
                        className="flex items-center gap-1.5 hover:opacity-70 transition-opacity"
                      >
                        {stock.agents && stock.agents.length > 0 ? (
                          <div className="flex items-center gap-1 flex-wrap">
                            {stock.agents.map(sa => {
                              const agent = agents.find(a => a.name === sa.agent_name)
                              return (
                                <Badge key={sa.agent_name} variant="default">
                                  {agent?.display_name || sa.agent_name}
                                  {sa.schedule && <Clock className="w-2.5 h-2.5 ml-1 opacity-70" />}
                                </Badge>
                              )
                            })}
                          </div>
                        ) : (
                          <span className="text-[12px] text-muted-foreground/50 flex items-center gap-1">
                            <Bot className="w-3.5 h-3.5" /> 未配置
                          </span>
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Switch checked={stock.enabled} onCheckedChange={() => toggleEnabled(stock)} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(stock)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-destructive hover:bg-destructive/8" onClick={() => handleDelete(stock.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Agent Assignment Dialog */}
      <Dialog open={!!agentDialogStock} onOpenChange={open => !open && setAgentDialogStock(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>配置监控 Agent</DialogTitle>
            <DialogDescription>
              为 {agentDialogStock?.name}（{agentDialogStock?.symbol}）配置监控策略
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            {agents.length === 0 ? (
              <p className="text-[13px] text-muted-foreground py-4 text-center">暂无可用 Agent，请先启动后台服务</p>
            ) : (
              agents.map(agent => {
                const stockAgent = agentDialogStock?.agents?.find(a => a.agent_name === agent.name)
                const isAssigned = !!stockAgent
                const currentSchedule = scheduleEdits[agent.name] ?? stockAgent?.schedule ?? ''
                return (
                  <div key={agent.name} className="rounded-xl bg-accent/30 hover:bg-accent/50 transition-colors overflow-hidden">
                    <div className="flex items-center justify-between p-3.5">
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${agent.enabled ? 'bg-emerald-500' : 'bg-border'}`} />
                        <div>
                          <span className="text-[13px] font-medium text-foreground">{agent.display_name}</span>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{agent.description}</p>
                        </div>
                      </div>
                      <Switch
                        checked={isAssigned}
                        onCheckedChange={() => agentDialogStock && toggleAgent(agentDialogStock, agent.name)}
                        disabled={!agent.enabled}
                      />
                    </div>
                    {isAssigned && (
                      <div className="px-3.5 pb-3.5 pt-0 space-y-2">
                        {/* Schedule + Trigger */}
                        <div className="flex items-center gap-2">
                          <div className="flex-1 relative">
                            <Clock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50" />
                            <input
                              value={currentSchedule}
                              onChange={e => setScheduleEdits(prev => ({ ...prev, [agent.name]: e.target.value }))}
                              onBlur={() => {
                                if (agentDialogStock && currentSchedule !== (stockAgent?.schedule ?? '')) {
                                  updateSchedule(agentDialogStock, agent.name, currentSchedule)
                                }
                              }}
                              placeholder={agent.schedule || '使用全局调度'}
                              className="w-full text-[11px] font-mono pl-7 pr-2 py-1.5 rounded-lg bg-background border border-border/50 focus:outline-none focus:border-primary/50 text-foreground placeholder:text-muted-foreground/40"
                            />
                          </div>
                          <Button
                            variant="secondary" size="sm" className="h-7 text-[11px] px-2.5"
                            disabled={triggeringAgent === agent.name}
                            onClick={() => agentDialogStock && triggerStockAgent(agentDialogStock.id, agent.name)}
                          >
                            {triggeringAgent === agent.name ? (
                              <span className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                            ) : (
                              <Play className="w-3 h-3" />
                            )}
                            触发
                          </Button>
                        </div>

                        {/* AI Model override */}
                        <div className="flex items-center gap-2">
                          <Cpu className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
                          <Select
                            value={stockAgent?.ai_model_id?.toString() ?? '__default__'}
                            onValueChange={val => {
                              if (!agentDialogStock) return
                              updateStockAgentModel(agentDialogStock, agent.name, val === '__default__' ? null : parseInt(val))
                            }}
                          >
                            <SelectTrigger className="h-6 text-[11px] flex-1 px-2 bg-background border-border/50">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__default__">使用 Agent 默认</SelectItem>
                              {services.map(svc => (
                                <SelectGroup key={svc.id}>
                                  <SelectLabel>{svc.name}</SelectLabel>
                                  {svc.models.map(m => (
                                    <SelectItem key={m.id} value={m.id.toString()}>
                                      {m.name}{m.name !== m.model ? ` (${m.model})` : ''}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Notify Channel override */}
                        {channels.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Bell className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
                            {channels.map(ch => {
                              const isSelected = (stockAgent?.notify_channel_ids || []).includes(ch.id)
                              return (
                                <button
                                  key={ch.id}
                                  onClick={() => agentDialogStock && toggleStockAgentChannel(agentDialogStock, agent.name, ch.id)}
                                  className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                                    isSelected
                                      ? 'bg-primary/10 border-primary/30 text-primary font-medium'
                                      : 'bg-background border-border/50 text-muted-foreground hover:border-primary/30'
                                  }`}
                                >
                                  {ch.name}
                                </button>
                              )
                            })}
                            {(stockAgent?.notify_channel_ids || []).length === 0 && (
                              <span className="text-[10px] text-muted-foreground">使用 Agent 默认</span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
