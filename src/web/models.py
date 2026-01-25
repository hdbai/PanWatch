from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, JSON, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from src.web.database import Base


class AIService(Base):
    """AI 服务商（base_url + api_key）"""
    __tablename__ = "ai_services"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)  # "OpenAI", "智谱", "DeepSeek"
    base_url = Column(String, nullable=False)
    api_key = Column(String, default="")
    created_at = Column(DateTime, server_default=func.now())

    models = relationship("AIModel", back_populates="service", cascade="all, delete-orphan")


class AIModel(Base):
    """AI 模型（属于某个服务商）"""
    __tablename__ = "ai_models"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)  # 显示名，如 "GLM-4-Flash"
    service_id = Column(Integer, ForeignKey("ai_services.id", ondelete="CASCADE"), nullable=False)
    model = Column(String, nullable=False)  # 实际模型标识，如 "glm-4-flash"
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())

    service = relationship("AIService", back_populates="models")


class NotifyChannel(Base):
    __tablename__ = "notify_channels"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)  # "telegram"
    config = Column(JSON, default={})  # {"bot_token": "...", "chat_id": "..."}
    enabled = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())


class Stock(Base):
    __tablename__ = "stocks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    symbol = Column(String, nullable=False)
    name = Column(String, nullable=False)
    market = Column(String, nullable=False)  # CN / HK / US
    cost_price = Column(Float, nullable=True)
    quantity = Column(Integer, nullable=True)
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    agents = relationship("StockAgent", back_populates="stock", cascade="all, delete-orphan")


class StockAgent(Base):
    """多对多: 每只股票可被多个 Agent 监控"""
    __tablename__ = "stock_agents"
    __table_args__ = (UniqueConstraint("stock_id", "agent_name", name="uq_stock_agent"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    stock_id = Column(Integer, ForeignKey("stocks.id", ondelete="CASCADE"), nullable=False)
    agent_name = Column(String, nullable=False)
    schedule = Column(String, default="")
    ai_model_id = Column(Integer, ForeignKey("ai_models.id", ondelete="SET NULL"), nullable=True)
    notify_channel_ids = Column(JSON, default=[])
    created_at = Column(DateTime, server_default=func.now())

    stock = relationship("Stock", back_populates="agents")


class AgentConfig(Base):
    __tablename__ = "agent_configs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, unique=True, nullable=False)
    display_name = Column(String, nullable=False)
    description = Column(String, default="")
    enabled = Column(Boolean, default=True)
    schedule = Column(String, default="")
    ai_model_id = Column(Integer, ForeignKey("ai_models.id", ondelete="SET NULL"), nullable=True)
    notify_channel_ids = Column(JSON, default=[])
    config = Column(JSON, default={})
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class AgentRun(Base):
    __tablename__ = "agent_runs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    agent_name = Column(String, nullable=False)
    status = Column(String, nullable=False)  # success / failed
    result = Column(String, default="")
    error = Column(String, default="")
    duration_ms = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())


class LogEntry(Base):
    __tablename__ = "log_entries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, nullable=False)
    level = Column(String, nullable=False)
    logger_name = Column(String, default="")
    message = Column(String, default="")
    created_at = Column(DateTime, server_default=func.now())


class AppSettings(Base):
    __tablename__ = "app_settings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    key = Column(String, unique=True, nullable=False)
    value = Column(String, default="")
    description = Column(String, default="")
