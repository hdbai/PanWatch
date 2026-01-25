import json
import logging
import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase

logger = logging.getLogger(__name__)

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "data", "panwatch.db")
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

engine = create_engine(f"sqlite:///{DB_PATH}", echo=False)
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)
    _migrate(engine)
    _migrate_old_providers(engine)
    _migrate_settings_to_models(engine)


def _has_column(conn, table: str, column: str) -> bool:
    try:
        conn.execute(text(f"SELECT {column} FROM {table} LIMIT 1"))
        return True
    except Exception:
        return False


def _has_table(conn, table: str) -> bool:
    try:
        conn.execute(text(f"SELECT 1 FROM {table} LIMIT 1"))
        return True
    except Exception:
        return False


def _migrate(engine):
    """增量 schema 迁移（SQLite ALTER TABLE ADD COLUMN）"""
    migrations = [
        ("stock_agents", "schedule", "ALTER TABLE stock_agents ADD COLUMN schedule TEXT DEFAULT ''"),
        ("agent_configs", "ai_model_id", "ALTER TABLE agent_configs ADD COLUMN ai_model_id INTEGER REFERENCES ai_models(id) ON DELETE SET NULL"),
        ("agent_configs", "notify_channel_ids", "ALTER TABLE agent_configs ADD COLUMN notify_channel_ids TEXT DEFAULT '[]'"),
        ("stock_agents", "ai_model_id", "ALTER TABLE stock_agents ADD COLUMN ai_model_id INTEGER REFERENCES ai_models(id) ON DELETE SET NULL"),
        ("stock_agents", "notify_channel_ids", "ALTER TABLE stock_agents ADD COLUMN notify_channel_ids TEXT DEFAULT '[]'"),
    ]
    with engine.connect() as conn:
        for table, column, sql in migrations:
            if not _has_column(conn, table, column):
                conn.execute(text(sql))
                conn.commit()


def _migrate_old_providers(engine):
    """如果存在旧的 ai_providers 表，迁移数据到 ai_services + ai_models"""
    with engine.connect() as conn:
        if not _has_table(conn, "ai_providers"):
            return
        # Check if it has the old schema (has base_url column)
        if not _has_column(conn, "ai_providers", "base_url"):
            return

        rows = conn.execute(text("SELECT id, name, base_url, api_key, model, is_default FROM ai_providers")).fetchall()
        if not rows:
            conn.execute(text("DROP TABLE IF EXISTS ai_providers"))
            conn.commit()
            return

        # Group by base_url+api_key to create services
        service_map = {}  # (base_url, api_key) -> service_id
        for row in rows:
            old_id, name, base_url, api_key, model, is_default = row
            key = (base_url, api_key)
            if key not in service_map:
                # Create service
                conn.execute(text(
                    "INSERT INTO ai_services (name, base_url, api_key) VALUES (:name, :base_url, :api_key)"
                ), {"name": name, "base_url": base_url, "api_key": api_key})
                result = conn.execute(text("SELECT last_insert_rowid()")).scalar()
                service_map[key] = result

            service_id = service_map[key]
            conn.execute(text(
                "INSERT INTO ai_models (name, service_id, model, is_default) VALUES (:name, :service_id, :model, :is_default)"
            ), {"name": name, "service_id": service_id, "model": model, "is_default": is_default})
            new_model_id = conn.execute(text("SELECT last_insert_rowid()")).scalar()

            # Update references: agent_configs.ai_provider_id → ai_model_id
            if _has_column(conn, "agent_configs", "ai_provider_id"):
                conn.execute(text(
                    "UPDATE agent_configs SET ai_model_id = :new_id WHERE ai_provider_id = :old_id"
                ), {"new_id": new_model_id, "old_id": old_id})
            # stock_agents.ai_provider_id → ai_model_id
            if _has_column(conn, "stock_agents", "ai_provider_id"):
                conn.execute(text(
                    "UPDATE stock_agents SET ai_model_id = :new_id WHERE ai_provider_id = :old_id"
                ), {"new_id": new_model_id, "old_id": old_id})

        conn.execute(text("DROP TABLE ai_providers"))
        conn.commit()
        logger.info(f"已迁移 {len(rows)} 条旧 AI Provider 数据到 ai_services + ai_models")


def _migrate_settings_to_models(engine):
    """将旧的 app_settings 中的 AI/通知配置迁移为 AIService+AIModel / NotifyChannel 记录"""
    with engine.connect() as conn:
        if not _has_table(conn, "app_settings"):
            return

        rows = conn.execute(text("SELECT key, value FROM app_settings")).fetchall()
        settings_map = {row[0]: row[1] for row in rows}

        ai_base_url = settings_map.get("ai_base_url", "")
        ai_api_key = settings_map.get("ai_api_key", "")
        ai_model = settings_map.get("ai_model", "")

        # Migrate AI settings if present and no services exist yet
        if ai_base_url and ai_model:
            existing = conn.execute(text("SELECT COUNT(*) FROM ai_services")).scalar()
            if existing == 0:
                conn.execute(text(
                    "INSERT INTO ai_services (name, base_url, api_key) VALUES (:name, :base_url, :api_key)"
                ), {"name": ai_model, "base_url": ai_base_url, "api_key": ai_api_key})
                service_id = conn.execute(text("SELECT last_insert_rowid()")).scalar()
                conn.execute(text(
                    "INSERT INTO ai_models (name, service_id, model, is_default) VALUES (:name, :service_id, :model, 1)"
                ), {"name": ai_model, "service_id": service_id, "model": ai_model})
                logger.info(f"已迁移 AI 配置: {ai_model}")

        # Migrate Telegram settings if present and no channels exist yet
        bot_token = settings_map.get("notify_telegram_bot_token", "")
        chat_id = settings_map.get("notify_telegram_chat_id", "")

        if bot_token:
            existing = conn.execute(text("SELECT COUNT(*) FROM notify_channels")).scalar()
            if existing == 0:
                config_json = json.dumps({"bot_token": bot_token, "chat_id": chat_id})
                conn.execute(text(
                    "INSERT INTO notify_channels (name, type, config, enabled, is_default) VALUES (:name, :type, :config, 1, 1)"
                ), {"name": "Telegram", "type": "telegram", "config": config_json})
                logger.info("已迁移 Telegram 配置为 NotifyChannel")

        # Remove old settings keys
        old_keys = ["ai_base_url", "ai_api_key", "ai_model", "notify_telegram_bot_token", "notify_telegram_chat_id"]
        for key in old_keys:
            if key in settings_map:
                conn.execute(text("DELETE FROM app_settings WHERE key = :key"), {"key": key})

        conn.commit()
