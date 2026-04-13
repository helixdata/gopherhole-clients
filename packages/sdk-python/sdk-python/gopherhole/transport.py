"""
GopherHole Transport Layer

Defines the Transport protocol and implementations for HTTP, WebSocket, and Auto modes.
The transport handles sending JSON-RPC requests to the hub.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Callable, Literal, Optional, Protocol

import httpx

logger = logging.getLogger(__name__)

TransportMode = Literal["http", "ws", "auto"]


class Transport(Protocol):
    """Protocol for sending JSON-RPC requests to the hub."""

    async def request(self, method: str, params: dict[str, Any], timeout: Optional[float] = None) -> Any:
        """Send a JSON-RPC request and return the parsed result."""
        ...

    @property
    def is_open(self) -> bool:
        """Whether this transport is currently able to send requests."""
        ...

    async def close(self) -> None:
        """Clean up resources."""
        ...


class HttpTransport:
    """
    HTTP Transport — sends JSON-RPC requests via HTTP POST to /a2a.
    Always available, no connection required.
    """

    def __init__(self, api_url: str, api_key: str, default_timeout: float) -> None:
        self._api_url = api_url
        self._api_key = api_key
        self._default_timeout = default_timeout
        self._http: Optional[httpx.AsyncClient] = None
        self._request_id = 0

    @property
    def is_open(self) -> bool:
        return True

    def _ensure_http(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(
                base_url=self._api_url,
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "A2A-Version": "1.0",
                },
                timeout=self._default_timeout,
            )
        return self._http

    async def request(self, method: str, params: dict[str, Any], timeout: Optional[float] = None) -> Any:
        http = self._ensure_http()
        self._request_id += 1

        response = await http.post(
            "/a2a",
            json={
                "jsonrpc": "2.0",
                "method": method,
                "params": params,
                "id": self._request_id,
            },
            timeout=timeout or self._default_timeout,
        )
        response.raise_for_status()

        data = response.json()
        if "error" in data:
            raise Exception(data["error"].get("message", "RPC error"))

        return data["result"]

    async def close(self) -> None:
        if self._http:
            await self._http.aclose()
            self._http = None


class WsTransport:
    """
    WebSocket Transport — sends JSON-RPC requests as frames over an existing WebSocket.
    Requires an open WebSocket connection. Falls back to HTTP if ws_fallback is enabled.
    """

    def __init__(
        self,
        get_ws: Callable[[], Any],
        default_timeout: float,
        ws_fallback: bool,
        api_url: str,
        api_key: str,
    ) -> None:
        self._get_ws = get_ws
        self._default_timeout = default_timeout
        self._http_fallback: Optional[HttpTransport] = (
            HttpTransport(api_url, api_key, default_timeout) if ws_fallback else None
        )
        self._pending: dict[int, asyncio.Future] = {}
        self._request_id = 0

    @property
    def is_open(self) -> bool:
        ws = self._get_ws()
        return ws is not None and ws.open

    def handle_message(self, data: dict[str, Any]) -> bool:
        """
        Handle an incoming WebSocket message. Returns True if the message was
        a JSON-RPC response that was consumed, False otherwise.
        """
        if data.get("jsonrpc") == "2.0" and data.get("id") is not None and ("result" in data or "error" in data):
            msg_id = data["id"]
            future = self._pending.pop(msg_id, None)
            if future and not future.done():
                if "error" in data:
                    future.set_exception(Exception(data["error"].get("message", "RPC error")))
                else:
                    future.set_result(data["result"])
                return True
        return False

    async def request(self, method: str, params: dict[str, Any], timeout: Optional[float] = None) -> Any:
        ws = self._get_ws()
        if ws is None or not ws.open:
            if self._http_fallback:
                return await self._http_fallback.request(method, params, timeout)
            raise ConnectionError("WebSocket not connected. Call connect() first or enable ws_fallback.")

        self._request_id += 1
        msg_id = self._request_id
        t = timeout or self._default_timeout

        loop = asyncio.get_event_loop()
        future: asyncio.Future = loop.create_future()
        self._pending[msg_id] = future

        await ws.send(json.dumps({
            "jsonrpc": "2.0",
            "id": msg_id,
            "method": method,
            "params": params,
        }))

        try:
            return await asyncio.wait_for(future, timeout=t)
        except asyncio.TimeoutError:
            self._pending.pop(msg_id, None)
            raise TimeoutError(f"Request timeout after {t}s")

    def cleanup(self) -> None:
        """Clean up pending requests on disconnect."""
        for future in self._pending.values():
            if not future.done():
                future.set_exception(ConnectionError("WebSocket disconnected"))
        self._pending.clear()

    async def close(self) -> None:
        self.cleanup()
        if self._http_fallback:
            await self._http_fallback.close()


class AutoTransport:
    """
    Auto Transport — uses HTTP for RPC requests (same as current SDK behaviour).
    This is the default transport that preserves backwards compatibility.
    """

    def __init__(self, api_url: str, api_key: str, default_timeout: float) -> None:
        self._http = HttpTransport(api_url, api_key, default_timeout)

    @property
    def is_open(self) -> bool:
        return True

    async def request(self, method: str, params: dict[str, Any], timeout: Optional[float] = None) -> Any:
        return await self._http.request(method, params, timeout)

    async def close(self) -> None:
        await self._http.close()
