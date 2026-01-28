from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.collectors.kline_collector import KlineCollector
from src.models.market import MarketCode

router = APIRouter()


class KlineItem(BaseModel):
    symbol: str = Field(..., description="股票代码")
    market: str = Field(..., description="市场: CN/HK/US")
    days: int | None = Field(default=60, description="K线天数")


class KlineBatchRequest(BaseModel):
    items: list[KlineItem]


class KlineSummaryItem(BaseModel):
    symbol: str = Field(..., description="股票代码")
    market: str = Field(..., description="市场: CN/HK/US")


class KlineSummaryBatchRequest(BaseModel):
    items: list[KlineSummaryItem]


def _parse_market(market: str) -> MarketCode:
    try:
        return MarketCode(market)
    except ValueError:
        raise HTTPException(400, f"不支持的市场: {market}")


def _serialize_klines(klines) -> list[dict]:
    return [
        {
            "date": k.date,
            "open": k.open,
            "close": k.close,
            "high": k.high,
            "low": k.low,
            "volume": k.volume,
        }
        for k in klines
    ]


@router.get("/{symbol}")
def get_klines(symbol: str, market: str = "CN", days: int = 60):
    """获取单只股票K线数据"""
    market_code = _parse_market(market)
    collector = KlineCollector(market_code)
    klines = collector.get_klines(symbol, days=days)
    return {
        "symbol": symbol,
        "market": market_code.value,
        "days": days,
        "klines": _serialize_klines(klines),
    }


@router.post("/batch")
def get_klines_batch(payload: KlineBatchRequest):
    """批量获取K线数据"""
    if not payload.items:
        return []

    results = []
    for item in payload.items:
        market_code = _parse_market(item.market)
        collector = KlineCollector(market_code)
        days = item.days or 60
        klines = collector.get_klines(item.symbol, days=days)
        results.append({
            "symbol": item.symbol,
            "market": market_code.value,
            "days": days,
            "klines": _serialize_klines(klines),
        })

    return results


@router.get("/{symbol}/summary")
def get_kline_summary(symbol: str, market: str = "CN"):
    """获取单只股票K线摘要"""
    market_code = _parse_market(market)
    collector = KlineCollector(market_code)
    summary = collector.get_kline_summary(symbol)
    return {
        "symbol": symbol,
        "market": market_code.value,
        "summary": summary,
    }


@router.post("/summary/batch")
def get_kline_summary_batch(payload: KlineSummaryBatchRequest):
    """批量获取K线摘要"""
    if not payload.items:
        return []

    results = []
    for item in payload.items:
        market_code = _parse_market(item.market)
        collector = KlineCollector(market_code)
        summary = collector.get_kline_summary(item.symbol)
        results.append({
            "symbol": item.symbol,
            "market": market_code.value,
            "summary": summary,
        })

    return results
