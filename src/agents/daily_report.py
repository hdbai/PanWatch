import logging
from datetime import datetime
from pathlib import Path

from src.agents.base import BaseAgent, AgentContext, AnalysisResult
from src.collectors.akshare_collector import AkshareCollector
from src.models.market import MarketCode, StockData, IndexData

logger = logging.getLogger(__name__)

PROMPT_PATH = Path(__file__).parent.parent.parent / "prompts" / "daily_report.txt"


class DailyReportAgent(BaseAgent):
    """盘后日报 Agent"""

    name = "daily_report"
    display_name = "盘后日报"
    description = "每日收盘后生成自选股日报，包含大盘概览、个股分析和明日关注"

    async def collect(self, context: AgentContext) -> dict:
        """采集大盘指数 + 自选股行情"""
        all_indices: list[IndexData] = []
        all_stocks: list[StockData] = []

        # 按市场分组采集
        market_symbols: dict[MarketCode, list[str]] = {}
        for stock in context.watchlist:
            market_symbols.setdefault(stock.market, []).append(stock.symbol)

        for market_code, symbols in market_symbols.items():
            collector = AkshareCollector(market_code)

            indices = await collector.get_index_data()
            all_indices.extend(indices)

            stocks = await collector.get_stock_data(symbols)
            all_stocks.extend(stocks)

        if not all_indices and not all_stocks:
            raise RuntimeError("数据采集失败：未获取到任何行情数据，请检查网络连接")

        return {
            "indices": all_indices,
            "stocks": all_stocks,
            "timestamp": datetime.now().isoformat(),
        }

    def build_prompt(self, data: dict, context: AgentContext) -> tuple[str, str]:
        """构建日报 Prompt"""
        system_prompt = PROMPT_PATH.read_text(encoding="utf-8")

        # 构建用户输入：结构化的市场数据
        lines = []
        lines.append(f"## 日期：{datetime.now().strftime('%Y-%m-%d')}\n")

        # 大盘指数
        lines.append("## 大盘指数")
        for idx in data["indices"]:
            direction = "↑" if idx.change_pct > 0 else "↓" if idx.change_pct < 0 else "→"
            lines.append(
                f"- {idx.name}: {idx.current_price:.2f} "
                f"{direction} {idx.change_pct:+.2f}% "
                f"成交额:{idx.turnover/1e8:.0f}亿"
            )

        # 自选股
        lines.append("\n## 自选股行情")
        watchlist_map = {s.symbol: s for s in context.watchlist}
        for stock in data["stocks"]:
            direction = "↑" if stock.change_pct > 0 else "↓" if stock.change_pct < 0 else "→"
            # hist 接口不返回名称，用 watchlist 配置补充
            stock_name = stock.name or (watchlist_map.get(stock.symbol) and watchlist_map[stock.symbol].name) or stock.symbol
            line = (
                f"- [{stock.market.value}] {stock_name}({stock.symbol}): "
                f"{stock.current_price:.2f} {direction} {stock.change_pct:+.2f}% "
                f"成交额:{stock.turnover/1e8:.2f}亿"
            )

            # 持仓信息（从 portfolio 获取汇总）
            position = context.portfolio.get_aggregated_position(stock.symbol)
            if position:
                total_qty = position["total_quantity"]
                avg_cost = position["avg_cost"]
                market_value = stock.current_price * total_qty
                pnl = market_value - position["total_cost"]
                pnl_pct = (stock.current_price - avg_cost) / avg_cost * 100 if avg_cost > 0 else 0
                line += f" | 持仓{total_qty}股 成本{avg_cost:.2f} 浮盈{pnl:+.0f}元({pnl_pct:+.1f}%)"

            lines.append(line)

        if not data["stocks"]:
            lines.append("- 今日无行情数据")

        # 账户资金概况
        if context.portfolio.accounts:
            lines.append("\n## 账户概况")
            for acc in context.portfolio.accounts:
                if acc.positions or acc.available_funds > 0:
                    acc_cost = acc.total_cost
                    lines.append(f"- {acc.name}: 持仓成本{acc_cost:.0f}元 可用资金{acc.available_funds:.0f}元")
            total_funds = context.portfolio.total_available_funds
            total_cost = context.portfolio.total_cost
            if total_funds > 0 or total_cost > 0:
                lines.append(f"- 合计: 总持仓成本{total_cost:.0f}元 总可用资金{total_funds:.0f}元")

        user_content = "\n".join(lines)
        return system_prompt, user_content
