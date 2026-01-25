from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.web.api import stocks, agents, settings, logs, providers, channels, datasources, accounts, history, news, market
from src.web.response import ResponseWrapperMiddleware

app = FastAPI(title="PanWatch API", version="0.1.0")

app.add_middleware(ResponseWrapperMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(stocks.router, prefix="/api/stocks", tags=["stocks"])
app.include_router(accounts.router, prefix="/api", tags=["accounts"])
app.include_router(agents.router, prefix="/api/agents", tags=["agents"])
app.include_router(providers.router, prefix="/api/providers", tags=["providers"])
app.include_router(channels.router, prefix="/api/channels", tags=["channels"])
app.include_router(datasources.router, prefix="/api/datasources", tags=["datasources"])
app.include_router(settings.router, prefix="/api/settings", tags=["settings"])
app.include_router(logs.router, prefix="/api/logs", tags=["logs"])
app.include_router(history.router, prefix="/api", tags=["history"])
app.include_router(news.router, prefix="/api/news", tags=["news"])
app.include_router(market.router, prefix="/api/market", tags=["market"])


@app.get("/api/health")
async def health():
    return {"status": "ok"}
