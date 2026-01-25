from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from src.web.database import get_db
from src.web.models import AgentConfig, AgentRun

router = APIRouter()


class AgentConfigUpdate(BaseModel):
    enabled: bool | None = None
    schedule: str | None = None
    ai_model_id: int | None = None
    notify_channel_ids: list[int] | None = None
    config: dict | None = None


class AgentConfigResponse(BaseModel):
    id: int
    name: str
    display_name: str
    description: str
    enabled: bool
    schedule: str
    ai_model_id: int | None
    notify_channel_ids: list[int]
    config: dict

    class Config:
        from_attributes = True


class AgentRunResponse(BaseModel):
    id: int
    agent_name: str
    status: str
    result: str
    error: str
    duration_ms: int
    created_at: str

    class Config:
        from_attributes = True


@router.get("", response_model=list[AgentConfigResponse])
def list_agents(db: Session = Depends(get_db)):
    agents = db.query(AgentConfig).all()
    return [_agent_to_response(a) for a in agents]


def _agent_to_response(agent: AgentConfig) -> dict:
    return {
        "id": agent.id,
        "name": agent.name,
        "display_name": agent.display_name,
        "description": agent.description,
        "enabled": agent.enabled,
        "schedule": agent.schedule or "",
        "ai_model_id": agent.ai_model_id,
        "notify_channel_ids": agent.notify_channel_ids or [],
        "config": agent.config or {},
    }


@router.put("/{agent_name}", response_model=AgentConfigResponse)
def update_agent(agent_name: str, update: AgentConfigUpdate, db: Session = Depends(get_db)):
    agent = db.query(AgentConfig).filter(AgentConfig.name == agent_name).first()
    if not agent:
        raise HTTPException(404, f"Agent {agent_name} 不存在")

    for key, value in update.model_dump(exclude_unset=True).items():
        setattr(agent, key, value)

    db.commit()
    db.refresh(agent)
    return _agent_to_response(agent)


@router.post("/{agent_name}/trigger")
async def trigger_agent_endpoint(agent_name: str, db: Session = Depends(get_db)):
    """手动触发 Agent 执行"""
    agent = db.query(AgentConfig).filter(AgentConfig.name == agent_name).first()
    if not agent:
        raise HTTPException(404, f"Agent {agent_name} 不存在")
    if not agent.enabled:
        raise HTTPException(400, f"Agent {agent_name} 未启用")

    from server import trigger_agent
    try:
        result = await trigger_agent(agent_name)
        return {"ok": True, "message": result}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Agent 执行失败: {e}")


@router.get("/{agent_name}/history", response_model=list[AgentRunResponse])
def get_agent_history(agent_name: str, limit: int = 20, db: Session = Depends(get_db)):
    return (
        db.query(AgentRun)
        .filter(AgentRun.agent_name == agent_name)
        .order_by(AgentRun.created_at.desc())
        .limit(limit)
        .all()
    )
