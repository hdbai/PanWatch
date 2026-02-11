import base64
import logging
from pathlib import Path

import httpx
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)


class AIClient:
    """OpenAI 协议兼容的 AI 客户端"""

    def __init__(self, base_url: str, api_key: str, model: str, proxy: str = ""):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key.strip()
        kwargs = {
            "base_url": self.base_url,
            "api_key": self.api_key,
        }
        if proxy:
            kwargs["http_client"] = None  # TODO: 如需代理，用 httpx 配置
        self.client = AsyncOpenAI(**kwargs)
        self.model = model
        self.total_tokens_used = 0

    async def chat(
        self,
        system_prompt: str,
        user_content: str,
        images: list[str] | None = None,
        temperature: float = 0.4,
    ) -> str:
        """
        调用 LLM 获取文本回复。

        Args:
            system_prompt: 系统提示词
            user_content: 用户输入内容
            images: 图片路径列表（用于多模态，可选）
            temperature: 生成温度
        """
        messages = [
            {"role": "system", "content": system_prompt},
        ]

        # 构建 user message
        if images:
            content_parts = [{"type": "text", "text": user_content}]
            for img_path in images:
                img_data = self._encode_image(img_path)
                if img_data:
                    content_parts.append({
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{img_data}"}
                    })
            messages.append({"role": "user", "content": content_parts})
        else:
            messages.append({"role": "user", "content": user_content})

        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=temperature,
            )
            # 记录 token 用量
            if response.usage:
                self.total_tokens_used += response.usage.total_tokens
                logger.debug(
                    f"Token usage: {response.usage.prompt_tokens} + "
                    f"{response.usage.completion_tokens} = {response.usage.total_tokens}"
                )

            return response.choices[0].message.content or ""

        except Exception as e:
            if self._should_retry_with_raw_auth(e):
                logger.warning("OpenAI SDK 请求疑似被鉴权拦截，尝试 raw Authorization 回退")
                return await self._chat_with_raw_auth(messages, temperature)
            logger.error(f"AI 调用失败: {e}")
            raise

    def _should_retry_with_raw_auth(self, err: Exception) -> bool:
        err_text = str(err).lower()
        blocked = "403" in err_text or "blocked" in err_text or "permission" in err_text
        has_non_bearer_key = self.api_key and not self.api_key.lower().startswith("bearer ")
        return blocked and has_non_bearer_key

    async def _chat_with_raw_auth(
        self, messages: list[dict], temperature: float
    ) -> str:
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
        }
        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
        }
        endpoint = f"{self.base_url}/chat/completions"
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(endpoint, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()

        usage = data.get("usage") or {}
        if usage:
            self.total_tokens_used += int(usage.get("total_tokens") or 0)
        return (
            ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        )

    def _encode_image(self, image_path: str) -> str | None:
        """将图片文件编码为 base64"""
        path = Path(image_path)
        if not path.exists():
            logger.warning(f"图片不存在: {image_path}")
            return None
        with open(path, "rb") as f:
            return base64.b64encode(f.read()).decode("utf-8")
