"""盘前分析 Agent - 开盘前展望今日走势"""
import logging
from datetime import datetime, date, timedelta
from pathlib import Path

from src.agents.base import BaseAgent, AgentContext, AnalysisResult
from src.collectors.akshare_collector import AkshareCollector
from src.collectors.kline_collector import KlineCollector
from src.collectors.news_collector import NewsCollector
from src.core.analysis_history import save_analysis, get_latest_analysis
from src.models.market import MarketCode

logger = logging.getLogger(__name__)

PROMPT_PATH = Path(__file__).parent.parent.parent / "prompts" / "premarket_outlook.txt"


class PremarketOutlookAgent(BaseAgent):
    """盘前分析 Agent"""

    name = "premarket_outlook"
    display_name = "盘前分析"
    description = "开盘前综合昨日分析和隔夜信息，展望今日走势"

    async def collect(self, context: AgentContext) -> dict:
        """采集盘前数据"""
        # 1. 获取昨日盘后分析
        yesterday_analysis = get_latest_analysis(
            agent_name="daily_report",
            stock_symbol="*",
            before_date=date.today(),
        )

        # 2. 获取美股指数（隔夜表现）
        us_indices = []
        try:
            # 使用腾讯 API 获取美股三大指数
            import httpx
            symbols = ["us.DJI", "us.IXIC", "us.INX"]  # 道琼斯、纳斯达克、标普500
            url = f"http://qt.gtimg.cn/q={','.join(symbols)}"
            with httpx.Client() as client:
                resp = client.get(url, timeout=10)
                content = resp.content.decode("gbk", errors="ignore")

            for line in content.strip().split(";"):
                if "=\"\"" in line or not line.strip():
                    continue
                try:
                    _, value = line.split('="', 1)
                    parts = value.rstrip('";').split("~")
                    if len(parts) >= 35:
                        us_indices.append({
                            "name": parts[1],
                            "current": float(parts[3] or 0),
                            "change_pct": float(parts[32] or 0),
                        })
                except:
                    pass
        except Exception as e:
            logger.warning(f"获取美股指数失败: {e}")

        # 3. 获取各股票的技术状态（开盘前看昨日 K 线）
        technical_data = {}
        market_symbols: dict[MarketCode, list[str]] = {}
        for stock in context.watchlist:
            market_symbols.setdefault(stock.market, []).append(stock.symbol)

        for market_code, symbols_list in market_symbols.items():
            kline_collector = KlineCollector(market_code)
            for symbol in symbols_list:
                try:
                    technical_data[symbol] = kline_collector.get_kline_summary(symbol)
                except Exception as e:
                    logger.warning(f"获取 {symbol} 技术指标失败: {e}")

        # 4. 获取相关新闻（最近 12 小时，基于数据源配置）
        news_items = []
        try:
            stock_symbols = [s.symbol for s in context.watchlist]
            news_collector = NewsCollector.from_database()
            all_news = await news_collector.fetch_all(symbols=stock_symbols, since_hours=12)
            # 筛选与自选股相关的新闻，最多取 10 条
            for news in all_news:
                if news.symbols or news.importance >= 2:  # 相关新闻或重要新闻
                    news_items.append({
                        "source": news.source,
                        "title": news.title,
                        "content": news.content[:200] if news.content else "",
                        "time": news.publish_time.strftime("%H:%M"),
                        "symbols": news.symbols,
                        "importance": news.importance,
                    })
                if len(news_items) >= 10:
                    break
            logger.info(f"采集到 {len(news_items)} 条相关新闻")
        except Exception as e:
            logger.warning(f"获取新闻失败: {e}")

        return {
            "yesterday_analysis": yesterday_analysis.content if yesterday_analysis else None,
            "us_indices": us_indices,
            "technical": technical_data,
            "news": news_items,
            "timestamp": datetime.now().isoformat(),
        }

    def build_prompt(self, data: dict, context: AgentContext) -> tuple[str, str]:
        """构建盘前分析 Prompt"""
        system_prompt = PROMPT_PATH.read_text(encoding="utf-8")

        # 辅助函数：安全获取数值，None 转为默认值
        def safe_num(value, default=0):
            return value if value is not None else default

        lines = []
        lines.append(f"## 日期：{datetime.now().strftime('%Y-%m-%d')} 盘前\n")

        # 昨日分析回顾
        if data.get("yesterday_analysis"):
            lines.append("## 昨日盘后分析回顾")
            # 截取前 500 字，避免过长
            content = data["yesterday_analysis"]
            if len(content) > 500:
                content = content[:500] + "..."
            lines.append(content)
            lines.append("")

        # 隔夜美股表现
        if data.get("us_indices"):
            lines.append("## 隔夜美股表现")
            for idx in data["us_indices"]:
                direction = "↑" if idx["change_pct"] > 0 else "↓" if idx["change_pct"] < 0 else "→"
                lines.append(f"- {idx['name']}: {idx['current']:.2f} {direction} {idx['change_pct']:+.2f}%")
            lines.append("")

        # 相关新闻
        if data.get("news"):
            lines.append("## 相关新闻资讯")
            for news in data["news"]:
                source_label = {"sina": "新浪", "eastmoney": "东财"}.get(news["source"], news["source"])
                importance_star = "⭐" * news.get("importance", 0) if news.get("importance") else ""
                symbols_tag = f"[{','.join(news['symbols'])}]" if news["symbols"] else ""
                lines.append(f"- [{news['time']}] {importance_star}{news['title']} {symbols_tag}")
                if news.get("content"):
                    lines.append(f"  > {news['content'][:100]}...")
            lines.append("")

        # 自选股技术状态
        lines.append("## 自选股技术状态")
        technical = data.get("technical", {})
        watchlist_map = {s.symbol: s for s in context.watchlist}

        for stock in context.watchlist:
            tech = technical.get(stock.symbol, {})
            if tech.get("error"):
                lines.append(f"\n### {stock.name}（{stock.symbol}）")
                lines.append(f"- 数据获取失败：{tech.get('error')}")
                continue

            lines.append(f"\n### {stock.name}（{stock.symbol}）")
            last_close = tech.get("last_close")
            if last_close is not None:
                lines.append(f"- 昨收价：{last_close:.2f}")
            if tech.get("trend"):
                lines.append(f"- 均线趋势：{tech['trend']}")
            if tech.get("macd_status"):
                lines.append(f"- MACD 状态：{tech['macd_status']}")
            support = tech.get("support")
            resistance = tech.get("resistance")
            if support is not None and resistance is not None:
                lines.append(f"- 支撑压力：{support:.2f} / {resistance:.2f}")
            change_5d = tech.get("change_5d")
            if change_5d is not None:
                lines.append(f"- 近期表现：5日{change_5d:+.1f}%")

            # 持仓信息
            position = context.portfolio.get_aggregated_position(stock.symbol)
            if position:
                style_labels = {"short": "短线", "swing": "波段", "long": "长线"}
                style = style_labels.get(position.get("trading_style", "swing"), "波段")
                avg_cost = safe_num(position.get('avg_cost'), 1)
                lines.append(f"- 持仓：{position['total_quantity']}股 成本{avg_cost:.2f}（{style}）")

        lines.append("\n请根据以上信息，给出今日交易展望。")

        user_content = "\n".join(lines)
        return system_prompt, user_content

    async def analyze(self, context: AgentContext, data: dict) -> AnalysisResult:
        """调用 AI 分析并保存到历史"""
        result = await super().analyze(context, data)

        # 保存到历史记录
        save_analysis(
            agent_name=self.name,
            stock_symbol="*",
            content=result.content,
            title=result.title,
            raw_data={
                "us_indices": data.get("us_indices"),
                "timestamp": data.get("timestamp"),
            },
        )
        logger.info(f"盘前分析已保存到历史记录")

        return result
