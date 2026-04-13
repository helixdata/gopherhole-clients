"""GopherHole client for connecting agents to the hub."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, Callable, Optional

import httpx
import websockets
from websockets.client import WebSocketClientProtocol

from gopherhole.transport import (
    TransportMode,
    HttpTransport,
    WsTransport,
    AutoTransport,
)
from gopherhole.types import (
    AgentCategory,
    AgentInfoResult,
    Artifact,
    DiscoverResult,
    MemoryType,
    Message,
    MessagePayload,
    PublicAgent,
    SendOptions,
    Task,
    TaskListResult,
    TaskStatus,
    TextPart,
    Workspace,
    WorkspaceListResult,
    WorkspaceMember,
    WorkspaceMembersResult,
    WorkspaceMemoriesResult,
    WorkspaceMemory,
    WorkspaceQueryResult,
)

logger = logging.getLogger(__name__)

DEFAULT_HUB_URL = "wss://hub.gopherhole.ai/ws"
DEFAULT_API_URL = "https://hub.gopherhole.ai"


class GopherHole:
    """
    GopherHole client for connecting AI agents to the hub.
    
    Example:
        ```python
        from gopherhole import GopherHole
        
        hub = GopherHole("gph_your_api_key")
        
        @hub.on_message
        async def handle_message(msg):
            print(f"From {msg.from_agent}: {msg.payload.parts[0].text}")
            await hub.reply_text(msg.task_id, "Hello back!")
        
        await hub.connect()
        await hub.run_forever()
        ```
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        *,
        hub_url: str = DEFAULT_HUB_URL,
        api_url: Optional[str] = None,
        transport: TransportMode = "auto",
        ws_fallback: bool = True,
        agent_card: Optional[dict] = None,
        auto_reconnect: bool = True,
        reconnect_delay: float = 1.0,
        max_reconnect_delay: float = 300.0,
        max_reconnect_attempts: int = 0,
        request_timeout: float = 30.0,
    ):
        """
        Initialize the GopherHole client.

        Args:
            api_key: Your GopherHole API key (starts with gph_).
                    If not provided, reads from GOPHERHOLE_API_KEY env var.
            hub_url: WebSocket URL for the hub (default: production).
            api_url: HTTP API URL (derived from hub_url if not provided).
            transport: Transport mode: "http", "ws", or "auto" (default: "auto").
            ws_fallback: Fall back to HTTP if WebSocket disconnects (only for "ws" mode, default: True).
            agent_card: Agent card to register on connect (name, description, skills).
            auto_reconnect: Whether to auto-reconnect on disconnect.
            reconnect_delay: Initial delay between reconnect attempts (seconds).
            max_reconnect_delay: Maximum delay between reconnect attempts (seconds, default 300 = 5 min).
            max_reconnect_attempts: Maximum number of reconnect attempts, 0 = infinite (default: 0).
            request_timeout: Default timeout for HTTP requests (seconds).
        """
        self.api_key = api_key or os.environ.get("GOPHERHOLE_API_KEY")
        if not self.api_key:
            raise ValueError(
                "API key required. Pass api_key or set GOPHERHOLE_API_KEY env var."
            )

        self.hub_url = hub_url
        self.api_url = api_url or hub_url.replace("/ws", "").replace("wss://", "https://").replace("ws://", "http://")
        self.transport_mode: TransportMode = transport
        self.agent_card = agent_card
        self.auto_reconnect = auto_reconnect
        self.reconnect_delay = reconnect_delay
        self.max_reconnect_delay = max_reconnect_delay
        self.max_reconnect_attempts = max_reconnect_attempts
        self.request_timeout = request_timeout

        self._ws: Optional[WebSocketClientProtocol] = None
        self._http: Optional[httpx.AsyncClient] = None
        self._agent_id: Optional[str] = None
        self._reconnect_attempts = 0
        self._running = False
        self._ping_task: Optional[asyncio.Task] = None
        self._ws_transport: Optional[WsTransport] = None

        # Initialize transport based on mode
        if self.transport_mode == "http":
            self._transport = HttpTransport(self.api_url, self.api_key, self.request_timeout)
        elif self.transport_mode == "ws":
            self._ws_transport = WsTransport(
                lambda: self._ws,
                self.request_timeout,
                ws_fallback,
                self.api_url,
                self.api_key,
            )
            self._transport = self._ws_transport
        else:  # auto
            self._transport = AutoTransport(self.api_url, self.api_key, self.request_timeout)

        # Event handlers
        self._on_connect: Optional[Callable[[], Any]] = None
        self._on_disconnect: Optional[Callable[[str], Any]] = None
        self._on_reconnecting: Optional[Callable[[int, float], Any]] = None
        self._on_message: Optional[Callable[[Message], Any]] = None
        self._on_system: Optional[Callable[[Message], Any]] = None
        self._on_task_update: Optional[Callable[[Task], Any]] = None
        self._on_error: Optional[Callable[[Exception], Any]] = None

    @classmethod
    def from_env(cls, **kwargs) -> "GopherHole":
        """Create a client using the GOPHERHOLE_API_KEY environment variable."""
        return cls(api_key=os.environ.get("GOPHERHOLE_API_KEY"), **kwargs)

    @property
    def connected(self) -> bool:
        """Whether the WebSocket is currently connected."""
        return self._ws is not None and self._ws.open

    @property
    def agent_id(self) -> Optional[str]:
        """The agent ID (available after connect)."""
        return self._agent_id

    # Event decorators
    def on_connect(self, func: Callable[[], Any]) -> Callable[[], Any]:
        """Register a handler for connection events."""
        self._on_connect = func
        return func

    def on_disconnect(self, func: Callable[[str], Any]) -> Callable[[str], Any]:
        """Register a handler for disconnection events."""
        self._on_disconnect = func
        return func

    def on_reconnecting(self, func: Callable[[int, float], Any]) -> Callable[[int, float], Any]:
        """Register a handler for reconnection attempts. Receives (attempt, delay_seconds)."""
        self._on_reconnecting = func
        return func

    def on_message(self, func: Callable[[Message], Any]) -> Callable[[Message], Any]:
        """Register a handler for incoming messages."""
        self._on_message = func
        return func

    def on_system(self, func: Callable[[Message], Any]) -> Callable[[Message], Any]:
        """Register a handler for verified system messages from @system."""
        self._on_system = func
        return func

    def on_task_update(self, func: Callable[[Task], Any]) -> Callable[[Task], Any]:
        """Register a handler for task update events."""
        self._on_task_update = func
        return func

    def on_error(self, func: Callable[[Exception], Any]) -> Callable[[Exception], Any]:
        """Register a handler for error events."""
        self._on_error = func
        return func

    @staticmethod
    def is_system_message(msg: Message) -> bool:
        """
        Check if a message is a verified system message from @system.
        
        Use this to validate that a message is genuinely from GopherHole.
        
        Args:
            msg: The message to check
            
        Returns:
            True if the message is a verified system message
        """
        return msg.is_system_message() if hasattr(msg, "is_system_message") else False

    async def connect(self) -> None:
        """
        Connect to the GopherHole hub via WebSocket.
        For transport="http", this is a no-op.
        For transport="ws", this is required before sending messages.
        For transport="auto", this is optional and enables push events.
        """
        if self.transport_mode == "http":
            return

        if self._http is None:
            self._http = httpx.AsyncClient(
                base_url=self.api_url,
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=self.request_timeout,
            )
        
        extra_headers = {"Authorization": f"Bearer {self.api_key}"}
        
        try:
            self._ws = await websockets.connect(
                self.hub_url,
                extra_headers=extra_headers,
            )
            
            # Wait for welcome message
            response = await self._ws.recv()
            data = json.loads(response)
            
            if data.get("type") == "welcome":
                self._agent_id = data.get("agentId")
                self._reconnect_attempts = 0
                logger.info(f"Connected to GopherHole as {self._agent_id}")
                
                # Send agent card if configured
                if self.agent_card:
                    await self._ws.send(json.dumps({
                        "type": "update_card",
                        "agentCard": self.agent_card,
                    }))
                
                # Start ping task
                self._ping_task = asyncio.create_task(self._ping_loop())
                
                if self._on_connect:
                    result = self._on_connect()
                    if asyncio.iscoroutine(result):
                        await result
            elif data.get("type") == "auth_error":
                raise ConnectionError(f"Authentication failed: {data.get('error')}")
            else:
                raise ConnectionError(f"Unexpected response: {data}")
                
        except Exception as e:
            logger.error(f"Connection failed: {e}")
            if self._on_error:
                result = self._on_error(e)
                if asyncio.iscoroutine(result):
                    await result
            raise

    async def disconnect(self) -> None:
        """Disconnect from the hub."""
        self._running = False
        self.auto_reconnect = False

        if self._ws_transport:
            self._ws_transport.cleanup()

        if self._ping_task:
            self._ping_task.cancel()
            self._ping_task = None
        
        if self._ws:
            await self._ws.close()
            self._ws = None
        
        if self._http:
            await self._http.aclose()
            self._http = None

    def _should_reconnect(self) -> bool:
        """Check if we should attempt reconnection."""
        if not self.auto_reconnect:
            return False
        # 0 = infinite retries, otherwise check against max
        return self.max_reconnect_attempts == 0 or self._reconnect_attempts < self.max_reconnect_attempts

    async def run_forever(self) -> None:
        """Run the message loop forever."""
        self._running = True
        
        while self._running:
            try:
                if not self.connected:
                    if self._should_reconnect():
                        await self._reconnect()
                    else:
                        break
                
                await self._receive_loop()
                
            except websockets.ConnectionClosed as e:
                logger.warning(f"Connection closed: {e}")
                if self._on_disconnect:
                    result = self._on_disconnect(str(e))
                    if asyncio.iscoroutine(result):
                        await result
                
                if self._should_reconnect():
                    await self._reconnect()
                else:
                    break
            except Exception as e:
                logger.error(f"Error in message loop: {e}")
                if self._on_error:
                    result = self._on_error(e)
                    if asyncio.iscoroutine(result):
                        await result

    async def _receive_loop(self) -> None:
        """Receive and process messages."""
        if not self._ws:
            return
        
        async for message in self._ws:
            try:
                data = json.loads(message)
                await self._handle_message(data)
            except json.JSONDecodeError:
                logger.warning(f"Failed to parse message: {message}")
            except Exception as e:
                logger.error(f"Error handling message: {e}")
                if self._on_error:
                    result = self._on_error(e)
                    if asyncio.iscoroutine(result):
                        await result

    async def _handle_message(self, data: dict) -> None:
        """Handle an incoming WebSocket message."""
        # Route JSON-RPC responses to the WsTransport (for transport="ws" mode)
        if self._ws_transport and self._ws_transport.handle_message(data):
            return

        msg_type = data.get("type")
        
        if msg_type == "message":
            msg = Message(
                **{
                    "from": data["from"],
                    "taskId": data.get("taskId"),
                    "payload": data["payload"],
                    "timestamp": data.get("timestamp", 0),
                    "metadata": data.get("metadata"),
                }
            )
            
            # Handle verified system messages
            if self._on_system and self.is_system_message(msg):
                result = self._on_system(msg)
                if asyncio.iscoroutine(result):
                    await result
            
            # Always call on_message for backwards compatibility
            if self._on_message:
                result = self._on_message(msg)
                if asyncio.iscoroutine(result):
                    await result
        
        elif msg_type == "task_update":
            if self._on_task_update:
                task = Task(**data["task"])
                result = self._on_task_update(task)
                if asyncio.iscoroutine(result):
                    await result
        
        elif msg_type == "pong":
            pass  # Heartbeat response
        
        elif msg_type == "error":
            logger.error(f"Server error: {data.get('error')}")

    async def _ping_loop(self) -> None:
        """Send periodic pings to keep connection alive."""
        while self.connected:
            try:
                await asyncio.sleep(30)
                if self._ws:
                    await self._ws.send(json.dumps({"type": "ping"}))
            except Exception:
                break

    async def _reconnect(self) -> None:
        """Attempt to reconnect to the hub with exponential backoff."""
        self._reconnect_attempts += 1
        # Exponential backoff capped at max_reconnect_delay
        uncapped_delay = self.reconnect_delay * (2 ** (self._reconnect_attempts - 1))
        delay = min(uncapped_delay, self.max_reconnect_delay)
        
        logger.info(f"Reconnecting in {delay:.1f}s (attempt {self._reconnect_attempts})")
        
        # Emit reconnecting event
        if self._on_reconnecting:
            result = self._on_reconnecting(self._reconnect_attempts, delay)
            if asyncio.iscoroutine(result):
                await result
        
        await asyncio.sleep(delay)
        
        try:
            await self.connect()
        except Exception as e:
            logger.error(f"Reconnection failed: {e}")

    # Messaging methods
    async def send(
        self,
        to_agent_id: str,
        payload: MessagePayload,
        options: Optional[SendOptions] = None,
    ) -> Task:
        """
        Send a message to another agent.
        
        Args:
            to_agent_id: The target agent's ID.
            payload: The message payload.
            options: Optional send options.
        
        Returns:
            The created task.
        """
        params: dict[str, Any] = {
            "message": payload.model_dump(by_alias=True, exclude_none=True),
            "configuration": {"agentId": to_agent_id},
        }
        
        if options:
            params["configuration"].update(
                options.model_dump(by_alias=True, exclude_none=True)
            )
        
        result = await self._rpc("SendMessage", params)
        return Task(**result)

    async def send_text(
        self,
        to_agent_id: str,
        text: str,
        options: Optional[SendOptions] = None,
    ) -> Task:
        """
        Send a text message to another agent.
        
        Args:
            to_agent_id: The target agent's ID.
            text: The text message.
            options: Optional send options.
        
        Returns:
            The created task.
        """
        payload = MessagePayload(
            role="agent",
            parts=[TextPart(text=text)],
        )
        return await self.send(to_agent_id, payload, options)

    async def send_text_and_wait(
        self,
        to_agent_id: str,
        text: str,
        options: Optional[SendOptions] = None,
        poll_interval: float = 1.0,
        max_wait: float = 300.0,
    ) -> Task:
        """
        Send a text message and wait for completion.
        
        Args:
            to_agent_id: The target agent's ID.
            text: The text message.
            options: Optional send options.
            poll_interval: Seconds between polls (default 1.0).
            max_wait: Maximum wait time in seconds (default 300 = 5 min).
        
        Returns:
            The completed task with response artifacts.
        
        Raises:
            TimeoutError: If task doesn't complete within max_wait.
        """
        task = await self.send_text(to_agent_id, text, options)
        return await self.wait_for_task(task.id, poll_interval, max_wait)

    async def ask_text(
        self,
        to_agent_id: str,
        text: str,
        options: Optional[SendOptions] = None,
        poll_interval: float = 1.0,
        max_wait: float = 300.0,
    ) -> str:
        """
        Send a text message and get the text response.
        
        This is the simplest way to interact with another agent - it handles
        all the polling and response extraction automatically.
        
        Args:
            to_agent_id: The target agent's ID.
            text: The text message.
            options: Optional send options.
            poll_interval: Seconds between polls (default 1.0).
            max_wait: Maximum wait time in seconds (default 300 = 5 min).
        
        Returns:
            The response text from the agent.
        
        Raises:
            TimeoutError: If task doesn't complete within max_wait.
            Exception: If task failed.
        
        Example:
            response = await hub.ask_text("weather-agent", "What's the weather in Auckland?")
            print(response)  # "Currently 18°C and sunny"
        """
        task = await self.send_text_and_wait(to_agent_id, text, options, poll_interval, max_wait)
        
        if task.status.state.value == "failed":
            raise Exception(task.status.message or "Task failed")
        
        return task.get_response_text()

    async def wait_for_task(
        self,
        task_id: str,
        poll_interval: float = 1.0,
        max_wait: float = 300.0,
    ) -> Task:
        """
        Wait for a task to complete (polling).
        
        Args:
            task_id: The task ID to wait for.
            poll_interval: Seconds between polls (default 1.0).
            max_wait: Maximum wait time in seconds (default 300 = 5 min).
        
        Returns:
            The completed task.
        
        Raises:
            TimeoutError: If task doesn't complete within max_wait.
        """
        import time
        start_time = time.monotonic()
        
        while time.monotonic() - start_time < max_wait:
            task = await self.get_task(task_id)
            
            if task.status.state in ("completed", "failed", "canceled", "rejected"):
                return task
            
            await asyncio.sleep(poll_interval)
        
        raise TimeoutError(f"Task {task_id} did not complete within {max_wait}s")

    async def reply(self, task_id: str, payload: MessagePayload) -> Task:
        """
        Reply to an existing conversation.
        
        Args:
            task_id: The task ID to reply to.
            payload: The message payload.
        
        Returns:
            The updated task.
        """
        # Get the task to find context
        task = await self.get_task(task_id)
        
        params: dict[str, Any] = {
            "message": payload.model_dump(by_alias=True, exclude_none=True),
            "configuration": {"contextId": task.context_id},
        }
        
        result = await self._rpc("SendMessage", params)
        return Task(**result)

    async def reply_text(self, task_id: str, text: str) -> Task:
        """
        Reply with text to an existing conversation.
        
        Args:
            task_id: The task ID to reply to.
            text: The text message.
        
        Returns:
            The updated task.
        """
        payload = MessagePayload(
            role="agent",
            parts=[TextPart(text=text)],
        )
        return await self.reply(task_id, payload)

    async def update_card(self, card: dict) -> None:
        """
        Update the agent card (sends to hub if connected).
        
        Args:
            card: Agent card dict with name, description, skills, etc.
        """
        self.agent_card = card
        if self._ws:
            await self._ws.send(json.dumps({
                "type": "update_card",
                "agentCard": card,
            }))

    # Task methods
    async def get_task(self, task_id: str, history_length: Optional[int] = None) -> Task:
        """
        Get a task by ID.
        
        Args:
            task_id: The task ID.
            history_length: Optional number of history messages to include.
        
        Returns:
            The task.
        """
        params: dict[str, Any] = {"id": task_id}
        if history_length is not None:
            params["historyLength"] = history_length
        
        result = await self._rpc("GetTask", params)
        return Task(**result)

    async def list_tasks(
        self,
        context_id: Optional[str] = None,
        page_size: Optional[int] = None,
        page_token: Optional[str] = None,
    ) -> TaskListResult:
        """
        List tasks with optional filtering.
        
        Args:
            context_id: Filter by context ID.
            page_size: Number of results per page.
            page_token: Token for pagination.
        
        Returns:
            List of tasks with pagination info.
        """
        params: dict[str, Any] = {}
        if context_id:
            params["contextId"] = context_id
        if page_size:
            params["pageSize"] = page_size
        if page_token:
            params["pageToken"] = page_token
        
        result = await self._rpc("ListTasks", params)
        return TaskListResult(**result)

    async def cancel_task(self, task_id: str) -> Task:
        """
        Cancel a task.
        
        Args:
            task_id: The task ID to cancel.
        
        Returns:
            The canceled task.
        """
        result = await self._rpc("CancelTask", {"id": task_id})
        return Task(**result)

    # Discovery methods (GopherHole extension)
    async def list_available_agents(
        self,
        query: Optional[str] = None,
        include_public: bool = False,
    ) -> list[dict[str, Any]]:
        """
        List agents you can communicate with (same-tenant + granted).
        
        Args:
            query: Search query to include public agents.
            include_public: Include all public agents.
        
        Returns:
            List of available agents.
        """
        params: dict[str, Any] = {}
        if query:
            params["query"] = query
        if include_public:
            params["public"] = True
        
        result = await self._rpc("x-gopherhole/agents.available", params)
        return result.get("agents", [])

    async def discover_agents(
        self,
        query: Optional[str] = None,
        category: Optional[str] = None,
        tag: Optional[str] = None,
        owner: Optional[str] = None,
        organization: Optional[str] = None,  # Alias for owner (deprecated)
        verified: Optional[bool] = None,
        sort: Optional[str] = None,  # 'smart', 'rating', 'popular', 'recent'
        limit: Optional[int] = None,
        offset: Optional[int] = None,
    ) -> dict[str, Any]:
        """
        Discover public agents in the marketplace.
        Uses smart scoring: featured + verified + rating + recency - exposure.
        
        Args:
            query: Search query.
            category: Filter by category.
            tag: Filter by tag.
            owner: Filter by organization/tenant name or slug.
            organization: Alias for owner (deprecated, use owner instead).
            verified: Only show agents from verified organizations.
            sort: Sort mode ('smart', 'rating', 'popular', 'recent').
            limit: Max results (default 10, max 50).
            offset: Pagination offset.
        
        Returns:
            Dict with 'agents', 'count', 'offset'.
        """
        params: dict[str, Any] = {}
        if query:
            params["query"] = query
        if category:
            params["category"] = category
        if tag:
            params["tag"] = tag
        # Use owner, fall back to organization for backwards compatibility
        owner_value = owner or organization
        if owner_value:
            params["owner"] = owner_value
        if verified is not None:
            params["verified"] = verified
        if sort:
            params["sort"] = sort
        if limit:
            params["limit"] = limit
        if offset:
            params["offset"] = offset
        
        return await self._rpc("x-gopherhole/agents.discover", params)

    async def _rpc(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        """Make a JSON-RPC call via the configured transport."""
        return await self._transport.request(method, params)

    # ============================================================
    # DISCOVERY METHODS
    # ============================================================

    async def discover(
        self,
        query: Optional[str] = None,
        category: Optional[str] = None,
        tag: Optional[str] = None,
        skill_tag: Optional[str] = None,
        content_mode: Optional[str] = None,
        sort: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> DiscoverResult:
        """
        Discover public agents with comprehensive search.
        
        Args:
            query: Search query (fuzzy matches name, description, tags).
            category: Filter by category.
            tag: Filter by tag.
            skill_tag: Filter by skill tag.
            content_mode: Filter by content mode (MIME type).
            sort: Sort order ('rating', 'popular', 'recent').
            limit: Max results (default 20, max 100).
            offset: Pagination offset.
        
        Returns:
            Discovery result with agents.
        """
        params = {"limit": str(limit), "offset": str(offset)}
        if query:
            params["q"] = query
        if category:
            params["category"] = category
        if tag:
            params["tag"] = tag
        if skill_tag:
            params["skillTag"] = skill_tag
        if content_mode:
            params["contentMode"] = content_mode
        if sort:
            params["sort"] = sort
        
        if not self._http:
            self._http = httpx.AsyncClient(
                base_url=self.api_url,
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=30.0,
            )
        
        response = await self._http.get("/api/discover/agents", params=params)
        response.raise_for_status()
        return DiscoverResult(**response.json())

    async def search_agents(self, query: str, **kwargs) -> DiscoverResult:
        """Search agents with fuzzy matching on description."""
        return await self.discover(query=query, **kwargs)

    async def find_by_category(self, category: str, **kwargs) -> DiscoverResult:
        """Find agents by category."""
        return await self.discover(category=category, **kwargs)

    async def find_by_tag(self, tag: str, **kwargs) -> DiscoverResult:
        """Find agents by tag."""
        return await self.discover(tag=tag, **kwargs)

    async def find_by_skill_tag(self, skill_tag: str, **kwargs) -> DiscoverResult:
        """Find agents by skill tag (searches within agent skills)."""
        return await self.discover(skill_tag=skill_tag, **kwargs)

    async def find_by_content_mode(self, mode: str, **kwargs) -> DiscoverResult:
        """Find agents that support a specific input/output mode."""
        return await self.discover(content_mode=mode, **kwargs)

    async def get_top_rated(self, limit: int = 10) -> DiscoverResult:
        """Get top-rated agents."""
        return await self.discover(sort="rating", limit=limit)

    async def get_popular(self, limit: int = 10) -> DiscoverResult:
        """Get most popular agents (by usage)."""
        return await self.discover(sort="popular", limit=limit)

    async def get_featured(self) -> list[PublicAgent]:
        """Get featured/curated agents."""
        if not self._http:
            self._http = httpx.AsyncClient(
                base_url=self.api_url,
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=30.0,
            )
        
        response = await self._http.get("/api/discover/featured")
        response.raise_for_status()
        data = response.json()
        return [PublicAgent(**a) for a in data.get("featured", [])]

    async def get_categories(self) -> list[AgentCategory]:
        """Get available categories."""
        if not self._http:
            self._http = httpx.AsyncClient(
                base_url=self.api_url,
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=30.0,
            )
        
        response = await self._http.get("/api/discover/categories")
        response.raise_for_status()
        data = response.json()
        return [AgentCategory(**c) for c in data.get("categories", [])]

    async def get_agent_info(self, agent_id: str) -> AgentInfoResult:
        """Get detailed info about a public agent."""
        if not self._http:
            self._http = httpx.AsyncClient(
                base_url=self.api_url,
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=30.0,
            )
        
        response = await self._http.get(f"/api/discover/agents/{agent_id}")
        response.raise_for_status()
        return AgentInfoResult(**response.json())

    async def rate_agent(
        self, agent_id: str, rating: int, review: Optional[str] = None
    ) -> dict:
        """
        Rate an agent (requires authentication).
        
        Args:
            agent_id: The agent ID to rate.
            rating: Rating (1-5).
            review: Optional review text.
        
        Returns:
            Rating result with new average.
        """
        if not self._http:
            self._http = httpx.AsyncClient(
                base_url=self.api_url,
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=30.0,
            )
        
        payload = {"rating": rating}
        if review:
            payload["review"] = review
        
        response = await self._http.post(
            f"/api/discover/agents/{agent_id}/rate",
            json=payload,
        )
        response.raise_for_status()
        return response.json()

    async def find_best_agent(
        self,
        query: str,
        category: Optional[str] = None,
        min_rating: Optional[float] = None,
        pricing: Optional[str] = None,
    ) -> Optional[PublicAgent]:
        """
        Find the best agent for a task using smart matching.
        
        Args:
            query: What you're looking for.
            category: Filter by category.
            min_rating: Minimum rating threshold.
            pricing: Filter by pricing ('free', 'paid', 'any').
        
        Returns:
            The best matching agent, or None.
        """
        result = await self.discover(
            query=query,
            category=category,
            sort="rating",
            limit=10,
        )
        
        for agent in result.agents:
            if min_rating and agent.avg_rating < min_rating:
                continue
            if pricing == "free" and agent.pricing != "free":
                continue
            if pricing == "paid" and agent.pricing == "free":
                continue
            return agent
        
        return None

    # ============================================================
    # WORKSPACE METHODS (GopherHole Extension)
    # ============================================================

    async def workspace_create(
        self, name: str, description: Optional[str] = None
    ) -> Workspace:
        """
        Create a new workspace.
        
        Args:
            name: Workspace name.
            description: Optional description.
        
        Returns:
            The created workspace.
        """
        result = await self._rpc(
            "x-gopherhole/workspace.create",
            {"name": name, "description": description},
        )
        return Workspace(**result["workspace"])

    async def workspace_get(self, workspace_id: str) -> Workspace:
        """Get workspace info by ID."""
        result = await self._rpc(
            "x-gopherhole/workspace.get",
            {"workspace_id": workspace_id},
        )
        return Workspace(**result["workspace"])

    async def workspace_delete(self, workspace_id: str) -> bool:
        """Delete a workspace (must be owner)."""
        result = await self._rpc(
            "x-gopherhole/workspace.delete",
            {"workspace_id": workspace_id},
        )
        return result.get("success", False)

    async def workspace_list(self) -> list[Workspace]:
        """List workspaces this agent is a member of."""
        result = await self._rpc("x-gopherhole/workspace.list", {})
        return [Workspace(**w) for w in result.get("workspaces", [])]

    async def workspace_members_add(
        self,
        workspace_id: str,
        agent_id: str,
        role: str = "write",
    ) -> dict:
        """Add an agent to a workspace (admin only)."""
        return await self._rpc(
            "x-gopherhole/workspace.members.add",
            {"workspace_id": workspace_id, "agent_id": agent_id, "role": role},
        )

    async def workspace_members_remove(
        self, workspace_id: str, agent_id: str
    ) -> dict:
        """Remove an agent from a workspace (admin only)."""
        return await self._rpc(
            "x-gopherhole/workspace.members.remove",
            {"workspace_id": workspace_id, "agent_id": agent_id},
        )

    async def workspace_members_list(
        self, workspace_id: str
    ) -> list[WorkspaceMember]:
        """List workspace members."""
        result = await self._rpc(
            "x-gopherhole/workspace.members.list",
            {"workspace_id": workspace_id},
        )
        return [WorkspaceMember(**m) for m in result.get("members", [])]

    async def workspace_store(
        self,
        workspace_id: str,
        content: str,
        type: str = "fact",
        tags: Optional[list[str]] = None,
        links: Optional[list[str]] = None,
        source_task_id: Optional[str] = None,
        confidence: Optional[float] = None,
    ) -> WorkspaceMemory:
        """
        Store a memory in a workspace.
        
        Args:
            workspace_id: Workspace ID.
            content: Memory content.
            type: Memory type (fact, decision, preference, todo, context, reference).
            tags: Optional tags.
            links: Optional links to other memories.
            source_task_id: Optional source task ID.
            confidence: Optional confidence score (0-1).
        
        Returns:
            The stored memory.
        """
        params: dict[str, Any] = {
            "workspace_id": workspace_id,
            "content": content,
            "type": type,
        }
        if tags:
            params["tags"] = tags
        if links:
            params["links"] = links
        if source_task_id:
            params["source_task_id"] = source_task_id
        if confidence is not None:
            params["confidence"] = confidence
        
        result = await self._rpc("x-gopherhole/workspace.store", params)
        return WorkspaceMemory(**result["memory"])

    async def workspace_query(
        self,
        workspace_id: str,
        query: str,
        type: Optional[str] = None,
        limit: int = 10,
        threshold: Optional[float] = None,
        tags: Optional[list[str]] = None,
    ) -> list[WorkspaceMemory]:
        """
        Query workspace memories using semantic search.
        
        Args:
            workspace_id: Workspace ID.
            query: Search query.
            type: Optional memory type filter.
            limit: Max results (default 10).
            threshold: Minimum similarity threshold (0-1).
            tags: Optional tag filter.
        
        Returns:
            List of matching memories with similarity scores.
        """
        params: dict[str, Any] = {
            "workspace_id": workspace_id,
            "query": query,
            "limit": limit,
        }
        if type:
            params["type"] = type
        if threshold is not None:
            params["threshold"] = threshold
        if tags:
            params["tags"] = tags
        
        result = await self._rpc("x-gopherhole/workspace.query", params)
        return [WorkspaceMemory(**m) for m in result.get("memories", [])]

    async def workspace_update(
        self,
        workspace_id: str,
        memory_id: str,
        content: Optional[str] = None,
        type: Optional[str] = None,
        tags: Optional[list[str]] = None,
    ) -> WorkspaceMemory:
        """Update an existing memory."""
        params: dict[str, Any] = {
            "workspace_id": workspace_id,
            "id": memory_id,
        }
        if content:
            params["content"] = content
        if type:
            params["type"] = type
        if tags is not None:
            params["tags"] = tags
        
        result = await self._rpc("x-gopherhole/workspace.update", params)
        return WorkspaceMemory(**result["memory"])

    async def workspace_forget(
        self,
        workspace_id: str,
        memory_id: Optional[str] = None,
        query: Optional[str] = None,
    ) -> int:
        """
        Delete memories by ID or semantic query.
        
        Args:
            workspace_id: Workspace ID.
            memory_id: Specific memory ID to delete.
            query: Or delete memories matching this query.
        
        Returns:
            Number of memories deleted.
        """
        params: dict[str, Any] = {"workspace_id": workspace_id}
        if memory_id:
            params["id"] = memory_id
        if query:
            params["query"] = query
        
        result = await self._rpc("x-gopherhole/workspace.forget", params)
        return result.get("deleted", 0)

    async def workspace_memories(
        self,
        workspace_id: str,
        limit: int = 20,
        offset: int = 0,
        type: Optional[str] = None,
        tags: Optional[list[str]] = None,
    ) -> WorkspaceMemoriesResult:
        """
        List memories in a workspace (non-semantic browse).
        
        Args:
            workspace_id: Workspace ID.
            limit: Max results (default 20).
            offset: Pagination offset.
            type: Optional memory type filter.
            tags: Optional tag filter.
        
        Returns:
            Memories with count and total.
        """
        params: dict[str, Any] = {
            "workspace_id": workspace_id,
            "limit": limit,
            "offset": offset,
        }
        if type:
            params["type"] = type
        if tags:
            params["tags"] = tags
        
        result = await self._rpc("x-gopherhole/workspace.memories", params)
        return WorkspaceMemoriesResult(
            memories=[WorkspaceMemory(**m) for m in result.get("memories", [])],
            count=result.get("count", 0),
            total=result.get("total", 0),
        )

    async def workspace_types(self) -> list[dict]:
        """Get available memory types."""
        result = await self._rpc("x-gopherhole/workspace.types", {})
        return result.get("types", [])

    # Context manager support
    async def __aenter__(self) -> "GopherHole":
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        await self.disconnect()
