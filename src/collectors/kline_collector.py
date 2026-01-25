"""K线和技术指标采集器 - 基于腾讯 API（更稳定）"""
import logging
from dataclasses import dataclass
from datetime import datetime

import httpx

from src.models.market import MarketCode

logger = logging.getLogger(__name__)

# 腾讯日K线 API
TENCENT_KLINE_URL = "http://web.ifzq.gtimg.cn/appstock/app/fqkline/get"


@dataclass
class KlineData:
    """K线数据"""
    date: str
    open: float
    close: float
    high: float
    low: float
    volume: float


@dataclass
class TechnicalIndicators:
    """技术指标"""
    ma5: float | None = None
    ma10: float | None = None
    ma20: float | None = None
    ma60: float | None = None
    macd_dif: float | None = None
    macd_dea: float | None = None
    macd_hist: float | None = None
    change_5d: float | None = None
    change_20d: float | None = None
    support: float | None = None
    resistance: float | None = None


def _tencent_symbol(symbol: str, market: MarketCode) -> str:
    """转换为腾讯 API 格式"""
    if market == MarketCode.HK:
        return f"hk{symbol}"
    if market == MarketCode.US:
        return f"us{symbol}"
    prefix = "sh" if symbol.startswith("6") or symbol.startswith("000") else "sz"
    return prefix + symbol


def _calculate_ma(closes: list[float], period: int) -> float | None:
    if len(closes) < period:
        return None
    return sum(closes[-period:]) / period


def _calculate_macd(closes: list[float], fast: int = 12, slow: int = 26, signal: int = 9) -> tuple[float, float, float] | None:
    if len(closes) < slow + signal:
        return None

    def ema(data: list[float], period: int) -> list[float]:
        result = [data[0]]
        multiplier = 2 / (period + 1)
        for price in data[1:]:
            result.append((price - result[-1]) * multiplier + result[-1])
        return result

    ema_fast = ema(closes, fast)
    ema_slow = ema(closes, slow)
    dif = [f - s for f, s in zip(ema_fast, ema_slow)]
    dea = ema(dif, signal)
    macd_hist = (dif[-1] - dea[-1]) * 2
    return dif[-1], dea[-1], macd_hist


class KlineCollector:
    """K线数据采集器（腾讯 API）"""

    def __init__(self, market: MarketCode):
        self.market = market

    def get_klines(self, symbol: str, days: int = 60) -> list[KlineData]:
        """获取日K线数据"""
        tencent_sym = _tencent_symbol(symbol, self.market)

        params = {
            "param": f"{tencent_sym},day,,,{days},qfq",
            "_var": "kline_dayqfq",
        }

        try:
            with httpx.Client(follow_redirects=True, timeout=10) as client:
                resp = client.get(TENCENT_KLINE_URL, params=params)
                text = resp.text

            # 解析 JS 变量格式: kline_dayqfq={...}
            if "=" not in text:
                logger.warning(f"获取 {symbol} K线数据失败: 格式错误")
                return []

            json_str = text.split("=", 1)[1].strip()
            if json_str.endswith(";"):
                json_str = json_str[:-1]

            import json
            data = json.loads(json_str)

            # 解析数据 - 兼容多种 API 格式
            raw_data = data.get("data", {})
            day_data = []

            if isinstance(raw_data, dict):
                # 旧格式: data.{symbol}.day 或 data.{symbol}.qfqday
                stock_data = raw_data.get(tencent_sym, {})
                if isinstance(stock_data, dict):
                    day_data = stock_data.get("day") or stock_data.get("qfqday") or []
            elif isinstance(raw_data, list):
                # 新格式: data 直接是 K 线数组
                day_data = raw_data

            if not day_data:
                logger.warning(f"K线数据为空 - symbol: {symbol}, code: {data.get('code')}, msg: {data.get('msg')}, data长度: {len(raw_data) if isinstance(raw_data, list) else 'N/A'}")

            klines = []
            for item in day_data:
                if len(item) >= 5:
                    klines.append(KlineData(
                        date=item[0],
                        open=float(item[1]),
                        close=float(item[2]),
                        high=float(item[3]),
                        low=float(item[4]),
                        volume=float(item[5]) if len(item) > 5 else 0,
                    ))

            return klines

        except Exception as e:
            logger.error(f"获取 {symbol} K线数据失败: {e}")
            return []

    def get_technical_indicators(self, symbol: str) -> TechnicalIndicators:
        """计算技术指标"""
        klines = self.get_klines(symbol, days=120)

        if not klines:
            return TechnicalIndicators()

        closes = [k.close for k in klines]

        ma5 = _calculate_ma(closes, 5)
        ma10 = _calculate_ma(closes, 10)
        ma20 = _calculate_ma(closes, 20)
        ma60 = _calculate_ma(closes, 60)

        macd_result = _calculate_macd(closes)
        macd_dif, macd_dea, macd_hist = macd_result if macd_result else (None, None, None)

        change_5d = None
        change_20d = None
        if len(closes) >= 6:
            change_5d = (closes[-1] - closes[-6]) / closes[-6] * 100
        if len(closes) >= 21:
            change_20d = (closes[-1] - closes[-21]) / closes[-21] * 100

        # 支撑压力位
        support = None
        resistance = None
        if len(klines) >= 5:
            recent = klines[-20:] if len(klines) >= 20 else klines
            support = min(k.low for k in recent)
            resistance = max(k.high for k in recent)

        return TechnicalIndicators(
            ma5=ma5,
            ma10=ma10,
            ma20=ma20,
            ma60=ma60,
            macd_dif=macd_dif,
            macd_dea=macd_dea,
            macd_hist=macd_hist,
            change_5d=change_5d,
            change_20d=change_20d,
            support=support,
            resistance=resistance,
        )

    def get_kline_summary(self, symbol: str) -> dict:
        """获取 K 线摘要（用于 prompt）"""
        klines = self.get_klines(symbol, days=30)
        indicators = self.get_technical_indicators(symbol)

        if not klines:
            return {"error": "无K线数据"}

        # 最近5日表现
        recent_5 = klines[-5:] if len(klines) >= 5 else klines
        up_days = sum(1 for i, k in enumerate(recent_5) if i > 0 and k.close > recent_5[i-1].close)

        # 趋势判断
        trend = "数据不足"
        if indicators.ma5 and indicators.ma10 and indicators.ma20:
            if indicators.ma5 > indicators.ma10 > indicators.ma20:
                trend = "多头排列"
            elif indicators.ma5 < indicators.ma10 < indicators.ma20:
                trend = "空头排列"
            else:
                trend = "均线交织"

        # MACD 状态
        macd_status = "无数据"
        if indicators.macd_dif is not None and indicators.macd_dea is not None:
            if indicators.macd_dif > indicators.macd_dea:
                macd_status = "金叉/多头"
            else:
                macd_status = "死叉/空头"

        last_close = klines[-1].close if klines else None

        return {
            "last_close": last_close,
            "recent_5_up": up_days,
            "trend": trend,
            "macd_status": macd_status,
            "ma5": indicators.ma5,
            "ma10": indicators.ma10,
            "ma20": indicators.ma20,
            "ma60": indicators.ma60,
            "change_5d": indicators.change_5d,
            "change_20d": indicators.change_20d,
            "support": indicators.support,
            "resistance": indicators.resistance,
        }
