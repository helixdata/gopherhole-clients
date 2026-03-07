"""Tests for the GopherHole client."""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock

import pytest
from gopherhole.client import GopherHole, DEFAULT_HUB_URL, DEFAULT_API_URL
from gopherhole.types import (
    Task,
    TaskStatus,
    TaskState,
    MessagePayload,
    TextPart,
    Artifact,
    PublicAgent,
    DiscoverResult,
    get_task_response_text,
)


class TestGopherHoleInit:
    """Tests for GopherHole initialization."""

    def test_init_with_api_key(self):
        """Should initialize with API key."""
        client = GopherHole("gph_test_key")
        assert client.api_key == "gph_test_key"
        assert client.hub_url == DEFAULT_HUB_URL
        assert client.api_url == DEFAULT_API_URL

    def test_init_with_env_var(self, monkeypatch):
        """Should read API key from environment variable."""
        monkeypatch.setenv("GOPHERHOLE_API_KEY", "gph_env_key")
        client = GopherHole.from_env()
        assert client.api_key == "gph_env_key"

    def test_init_without_api_key_raises(self, monkeypatch):
        """Should raise error when no API key provided."""
        monkeypatch.delenv("GOPHERHOLE_API_KEY", raising=False)
        with pytest.raises(ValueError, match="API key required"):
            GopherHole(None)

    def test_init_with_custom_urls(self):
        """Should accept custom hub and API URLs."""
        client = GopherHole(
            "gph_test_key",
            hub_url="wss://custom.hub.ai/ws",
            api_url="https://custom.api.ai",
        )
        assert client.hub_url == "wss://custom.hub.ai/ws"
        assert client.api_url == "https://custom.api.ai"

    def test_init_derives_api_url_from_hub_url(self):
        """Should derive API URL from hub URL if not provided."""
        client = GopherHole("gph_test_key", hub_url="wss://my.hub.ai/ws")
        assert client.api_url == "https://my.hub.ai"

    def test_init_with_all_options(self):
        """Should accept all configuration options."""
        client = GopherHole(
            "gph_test_key",
            hub_url="wss://hub.test.ai/ws",
            agent_card={"name": "Test Agent"},
            auto_reconnect=False,
            reconnect_delay=2.0,
            max_reconnect_attempts=5,
            request_timeout=60.0,
        )
        assert client.auto_reconnect is False
        assert client.reconnect_delay == 2.0
        assert client.max_reconnect_attempts == 5
        assert client.request_timeout == 60.0
        assert client.agent_card == {"name": "Test Agent"}


class TestGopherHoleConnection:
    """Tests for WebSocket connection - skipped due to complex mocking requirements."""
    
    @pytest.mark.skip(reason="WebSocket mocking requires integration test setup")
    @pytest.mark.asyncio
    async def test_connect_establishes_connection(self):
        """Should establish WebSocket connection."""
        pass

    @pytest.mark.skip(reason="WebSocket mocking requires integration test setup")
    @pytest.mark.asyncio
    async def test_connect_sends_agent_card(self):
        """Should send agent card on connect if configured."""
        pass

    @pytest.mark.skip(reason="WebSocket mocking requires integration test setup")
    @pytest.mark.asyncio
    async def test_connect_fires_on_connect_handler(self):
        """Should fire on_connect handler."""
        pass

    @pytest.mark.skip(reason="WebSocket mocking requires integration test setup")
    @pytest.mark.asyncio
    async def test_disconnect_closes_connection(self):
        """Should close WebSocket connection."""
        pass


class TestGopherHoleMessaging:
    """Tests for messaging methods."""

    @pytest.fixture
    def mock_rpc_response(self):
        """Create a mock RPC response."""
        return {
            "id": "task-123",
            "contextId": "ctx-456",
            "status": {
                "state": "submitted",
                "timestamp": "2024-01-01T00:00:00Z",
            },
        }

    @pytest.fixture
    def mock_http_client(self, mock_rpc_response):
        """Create a mock HTTP client with RPC response."""
        client = MagicMock()
        response = MagicMock()
        response.json.return_value = {
            "jsonrpc": "2.0",
            "result": mock_rpc_response,
            "id": 1,
        }
        response.raise_for_status = MagicMock()
        
        async def mock_post(*args, **kwargs):
            return response
        
        client.post = mock_post
        client.aclose = AsyncMock()
        return client

    @pytest.mark.asyncio
    async def test_send_creates_task(self, mock_http_client, mock_rpc_response):
        """Should send message and return task."""
        client = GopherHole("gph_test_key")
        client._http = mock_http_client
        
        payload = MessagePayload(
            role="agent",
            parts=[TextPart(text="Hello")],
        )
        task = await client.send("agent-id", payload)
        
        assert task.id == "task-123"
        assert task.context_id == "ctx-456"

    @pytest.mark.asyncio
    async def test_send_text_creates_text_message(self, mock_http_client):
        """Should send text message."""
        client = GopherHole("gph_test_key")
        client._http = mock_http_client
        
        task = await client.send_text("agent-id", "Hello world")
        assert task.id == "task-123"

    @pytest.mark.asyncio
    async def test_send_with_options(self, mock_http_client):
        """Should include options in configuration."""
        from gopherhole.types import SendOptions
        
        client = GopherHole("gph_test_key")
        client._http = mock_http_client
        
        options = SendOptions(context_id="existing-ctx")
        task = await client.send_text("agent-id", "Hello", options)
        assert task.id == "task-123"


class TestGopherHoleTaskMethods:
    """Tests for task management methods."""

    @pytest.mark.asyncio
    async def test_get_task(self):
        """Should fetch task by ID."""
        mock_http = MagicMock()
        response = MagicMock()
        response.json.return_value = {
            "jsonrpc": "2.0",
            "result": {
                "id": "task-123",
                "contextId": "ctx-456",
                "status": {"state": "completed", "timestamp": "2024-01-01T00:00:00Z"},
            },
            "id": 1,
        }
        response.raise_for_status = MagicMock()
        
        async def mock_post(*args, **kwargs):
            return response
        
        mock_http.post = mock_post

        client = GopherHole("gph_test_key")
        client._http = mock_http
        
        task = await client.get_task("task-123")
        
        assert task.id == "task-123"

    @pytest.mark.asyncio
    async def test_cancel_task(self):
        """Should cancel task by ID."""
        mock_http = MagicMock()
        response = MagicMock()
        response.json.return_value = {
            "jsonrpc": "2.0",
            "result": {
                "id": "task-123",
                "contextId": "ctx-456",
                "status": {"state": "canceled", "timestamp": "2024-01-01T00:00:00Z"},
            },
            "id": 1,
        }
        response.raise_for_status = MagicMock()
        
        async def mock_post(*args, **kwargs):
            return response
        
        mock_http.post = mock_post

        client = GopherHole("gph_test_key")
        client._http = mock_http
        
        task = await client.cancel_task("task-123")
        
        assert task.status.state == TaskState.CANCELED

    @pytest.mark.asyncio
    async def test_list_tasks(self):
        """Should list tasks."""
        mock_http = MagicMock()
        response = MagicMock()
        response.json.return_value = {
            "jsonrpc": "2.0",
            "result": {
                "tasks": [
                    {"id": "task-1", "contextId": "ctx-1", "status": {"state": "completed", "timestamp": "2024-01-01T00:00:00Z"}},
                    {"id": "task-2", "contextId": "ctx-2", "status": {"state": "working", "timestamp": "2024-01-01T00:00:00Z"}},
                ],
                "totalSize": 2,
            },
            "id": 1,
        }
        response.raise_for_status = MagicMock()
        
        async def mock_post(*args, **kwargs):
            return response
        
        mock_http.post = mock_post

        client = GopherHole("gph_test_key")
        client._http = mock_http
        
        result = await client.list_tasks(page_size=10)
        
        assert len(result.tasks) == 2
        assert result.total_size == 2


class TestGopherHoleWaitForTask:
    """Tests for wait_for_task method."""

    @pytest.mark.asyncio
    async def test_wait_for_task_returns_completed_task(self):
        """Should return immediately when task is completed."""
        client = GopherHole("gph_test_key")
        
        async def mock_get_task(task_id, history_length=None):
            return Task(
                id=task_id,
                contextId="ctx-456",
                status=TaskStatus(state=TaskState.COMPLETED, timestamp="2024-01-01T00:00:00Z"),
            )
        
        client.get_task = mock_get_task
        
        task = await client.wait_for_task("task-123", poll_interval=0.1, max_wait=1.0)
        
        assert task.status.state == TaskState.COMPLETED

    @pytest.mark.asyncio
    async def test_wait_for_task_polls_until_complete(self):
        """Should poll until task completes."""
        client = GopherHole("gph_test_key")
        
        call_count = 0
        
        async def mock_get_task(task_id, history_length=None):
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                return Task(
                    id=task_id,
                    contextId="ctx-456",
                    status=TaskStatus(state=TaskState.WORKING, timestamp="2024-01-01T00:00:00Z"),
                )
            return Task(
                id=task_id,
                contextId="ctx-456",
                status=TaskStatus(state=TaskState.COMPLETED, timestamp="2024-01-01T00:00:00Z"),
            )
        
        client.get_task = mock_get_task
        
        task = await client.wait_for_task("task-123", poll_interval=0.01, max_wait=1.0)
        
        assert call_count == 3
        assert task.status.state == TaskState.COMPLETED

    @pytest.mark.asyncio
    async def test_wait_for_task_timeout(self):
        """Should raise TimeoutError when task doesn't complete."""
        client = GopherHole("gph_test_key")
        
        async def mock_get_task(task_id, history_length=None):
            return Task(
                id=task_id,
                contextId="ctx-456",
                status=TaskStatus(state=TaskState.WORKING, timestamp="2024-01-01T00:00:00Z"),
            )
        
        client.get_task = mock_get_task
        
        with pytest.raises(TimeoutError, match="did not complete"):
            await client.wait_for_task("task-123", poll_interval=0.01, max_wait=0.05)


class TestGopherHoleAskText:
    """Tests for ask_text convenience method."""

    @pytest.mark.asyncio
    async def test_ask_text_returns_response(self):
        """Should return extracted response text."""
        client = GopherHole("gph_test_key")
        
        async def mock_send_text_and_wait(agent_id, text, options, poll_interval, max_wait):
            return Task(
                id="task-123",
                contextId="ctx-456",
                status=TaskStatus(state=TaskState.COMPLETED, timestamp="2024-01-01T00:00:00Z"),
                artifacts=[
                    Artifact(
                        parts=[TextPart(text="Response from agent")],
                    ),
                ],
            )
        
        client.send_text_and_wait = mock_send_text_and_wait
        
        response = await client.ask_text("agent-id", "Hello")
        
        assert response == "Response from agent"

    @pytest.mark.asyncio
    async def test_ask_text_raises_on_failure(self):
        """Should raise exception when task fails."""
        client = GopherHole("gph_test_key")
        
        async def mock_send_text_and_wait(agent_id, text, options, poll_interval, max_wait):
            return Task(
                id="task-123",
                contextId="ctx-456",
                status=TaskStatus(state=TaskState.FAILED, timestamp="2024-01-01T00:00:00Z", message="Something went wrong"),
            )
        
        client.send_text_and_wait = mock_send_text_and_wait
        
        with pytest.raises(Exception, match="Something went wrong"):
            await client.ask_text("agent-id", "Hello")


class TestGopherHoleDiscovery:
    """Tests for discovery methods."""

    def _create_mock_http(self, return_value):
        """Create a mock HTTP client that returns the given value."""
        mock_http = MagicMock()
        response = MagicMock()
        response.json.return_value = return_value
        response.raise_for_status = MagicMock()
        
        async def mock_get(*args, **kwargs):
            return response
        
        async def mock_post(*args, **kwargs):
            return response
        
        mock_http.get = mock_get
        mock_http.post = mock_post
        return mock_http

    @pytest.mark.asyncio
    async def test_discover(self):
        """Should call discover endpoint with params."""
        mock_http = self._create_mock_http({
            "agents": [
                {"id": "agent-1", "name": "Agent 1", "avgRating": 4.5, "ratingCount": 10, "tags": [], "tenantName": "tenant1"},
            ],
            "count": 1,
            "offset": 0,
        })

        client = GopherHole("gph_test_key")
        client._http = mock_http
        
        result = await client.discover(query="weather", category="utility", limit=10)
        
        assert len(result.agents) == 1

    @pytest.mark.asyncio
    async def test_search_agents(self):
        """Should search agents by query."""
        mock_http = self._create_mock_http({"agents": [], "count": 0, "offset": 0})

        client = GopherHole("gph_test_key")
        client._http = mock_http
        
        result = await client.search_agents("code assistant")
        assert result.count == 0

    @pytest.mark.asyncio
    async def test_find_by_category(self):
        """Should filter by category."""
        mock_http = self._create_mock_http({"agents": [], "count": 0, "offset": 0})

        client = GopherHole("gph_test_key")
        client._http = mock_http
        
        result = await client.find_by_category("productivity")
        assert result.count == 0

    @pytest.mark.asyncio
    async def test_find_by_tag(self):
        """Should filter by tag."""
        mock_http = self._create_mock_http({"agents": [], "count": 0, "offset": 0})

        client = GopherHole("gph_test_key")
        client._http = mock_http
        
        result = await client.find_by_tag("ai")
        assert result.count == 0

    @pytest.mark.asyncio
    async def test_find_by_skill_tag(self):
        """Should filter by skill tag."""
        mock_http = self._create_mock_http({"agents": [], "count": 0, "offset": 0})

        client = GopherHole("gph_test_key")
        client._http = mock_http
        
        result = await client.find_by_skill_tag("summarization")
        assert result.count == 0

    @pytest.mark.asyncio
    async def test_get_top_rated(self):
        """Should get top rated agents."""
        mock_http = self._create_mock_http({"agents": [], "count": 0, "offset": 0})

        client = GopherHole("gph_test_key")
        client._http = mock_http
        
        result = await client.get_top_rated(5)
        assert result.count == 0

    @pytest.mark.asyncio
    async def test_get_popular(self):
        """Should get popular agents."""
        mock_http = self._create_mock_http({"agents": [], "count": 0, "offset": 0})

        client = GopherHole("gph_test_key")
        client._http = mock_http
        
        result = await client.get_popular(5)
        assert result.count == 0

    @pytest.mark.asyncio
    async def test_get_featured(self):
        """Should get featured agents."""
        mock_http = self._create_mock_http({
            "featured": [{"id": "featured-1", "name": "Featured Agent", "avgRating": 5.0, "ratingCount": 100, "tags": [], "tenantName": "tenant1"}],
        })

        client = GopherHole("gph_test_key")
        client._http = mock_http
        
        agents = await client.get_featured()
        
        assert len(agents) == 1
        assert agents[0].id == "featured-1"

    @pytest.mark.asyncio
    async def test_get_categories(self):
        """Should get available categories."""
        mock_http = self._create_mock_http({
            "categories": [
                {"name": "productivity", "count": 10},
                {"name": "utility", "count": 5},
            ],
        })

        client = GopherHole("gph_test_key")
        client._http = mock_http
        
        categories = await client.get_categories()
        
        assert len(categories) == 2
        assert categories[0].name == "productivity"

    @pytest.mark.asyncio
    async def test_get_agent_info(self):
        """Should get detailed agent info."""
        mock_http = self._create_mock_http({
            "agent": {"id": "agent-1", "name": "Agent 1", "avgRating": 4.5, "ratingCount": 10, "tags": [], "tenantName": "tenant1"},
            "stats": {"avgRating": 4.5, "ratingCount": 10, "totalMessages": 100, "successRate": 0.95, "avgResponseTime": 1000},
            "reviews": [],
        })

        client = GopherHole("gph_test_key")
        client._http = mock_http
        
        info = await client.get_agent_info("agent-1")
        
        assert info.agent.id == "agent-1"
        assert info.stats.avg_rating == 4.5

    @pytest.mark.asyncio
    async def test_rate_agent(self):
        """Should rate an agent."""
        mock_http = self._create_mock_http({
            "success": True,
            "avgRating": 4.6,
            "ratingCount": 11,
        })

        client = GopherHole("gph_test_key")
        client._http = mock_http
        
        result = await client.rate_agent("agent-1", 5, "Great agent!")
        
        assert result["avgRating"] == 4.6

    @pytest.mark.asyncio
    async def test_find_best_agent(self):
        """Should find best matching agent."""
        mock_http = self._create_mock_http({
            "agents": [
                {"id": "agent-1", "avgRating": 4.8, "pricing": "free", "ratingCount": 10, "tags": [], "name": "Agent 1", "tenantName": "tenant1"},
                {"id": "agent-2", "avgRating": 4.5, "pricing": "paid", "ratingCount": 5, "tags": [], "name": "Agent 2", "tenantName": "tenant1"},
            ],
            "count": 2,
            "offset": 0,
        })

        client = GopherHole("gph_test_key")
        client._http = mock_http
        
        agent = await client.find_best_agent("code help")
        
        assert agent.id == "agent-1"

    @pytest.mark.asyncio
    async def test_find_best_agent_with_filters(self):
        """Should apply filters when finding best agent."""
        mock_http = self._create_mock_http({
            "agents": [
                {"id": "agent-1", "avgRating": 3.5, "pricing": "free", "ratingCount": 10, "tags": [], "name": "Agent 1", "tenantName": "tenant1"},
                {"id": "agent-2", "avgRating": 4.5, "pricing": "free", "ratingCount": 5, "tags": [], "name": "Agent 2", "tenantName": "tenant1"},
            ],
            "count": 2,
            "offset": 0,
        })

        client = GopherHole("gph_test_key")
        client._http = mock_http
        
        agent = await client.find_best_agent("code", min_rating=4.0)
        
        assert agent.id == "agent-2"

    @pytest.mark.asyncio
    async def test_find_best_agent_no_match(self):
        """Should return None when no agent matches."""
        mock_http = self._create_mock_http({"agents": [], "count": 0, "offset": 0})

        client = GopherHole("gph_test_key")
        client._http = mock_http
        
        agent = await client.find_best_agent("nonexistent")
        
        assert agent is None


class TestGopherHoleEventHandlers:
    """Tests for event handler decorators."""

    def test_on_connect_decorator(self):
        """Should register connect handler."""
        client = GopherHole("gph_test_key")
        handler = MagicMock()
        
        client.on_connect(handler)
        
        assert client._on_connect is handler

    def test_on_disconnect_decorator(self):
        """Should register disconnect handler."""
        client = GopherHole("gph_test_key")
        handler = MagicMock()
        
        client.on_disconnect(handler)
        
        assert client._on_disconnect is handler

    def test_on_message_decorator(self):
        """Should register message handler."""
        client = GopherHole("gph_test_key")
        handler = MagicMock()
        
        client.on_message(handler)
        
        assert client._on_message is handler

    def test_on_task_update_decorator(self):
        """Should register task update handler."""
        client = GopherHole("gph_test_key")
        handler = MagicMock()
        
        client.on_task_update(handler)
        
        assert client._on_task_update is handler

    def test_on_error_decorator(self):
        """Should register error handler."""
        client = GopherHole("gph_test_key")
        handler = MagicMock()
        
        client.on_error(handler)
        
        assert client._on_error is handler


class TestGopherHoleContextManager:
    """Tests for async context manager - skipped due to WebSocket complexity."""

    @pytest.mark.skip(reason="WebSocket mocking requires integration test setup")
    @pytest.mark.asyncio
    async def test_async_context_manager(self):
        """Should connect on enter and disconnect on exit."""
        pass


class TestGetTaskResponseText:
    """Tests for get_task_response_text helper."""

    def test_extracts_text_from_artifacts(self):
        """Should extract text from artifacts."""
        task = Task(
            id="task-123",
            contextId="ctx-456",
            status=TaskStatus(state=TaskState.COMPLETED, timestamp="2024-01-01T00:00:00Z"),
            artifacts=[
                Artifact(
                    parts=[
                        TextPart(text="First response"),
                        TextPart(text="Second response"),
                    ],
                ),
            ],
        )
        
        result = get_task_response_text(task)
        
        assert result == "First response\nSecond response"

    def test_falls_back_to_history(self):
        """Should fall back to history when no artifacts."""
        task = Task(
            id="task-123",
            contextId="ctx-456",
            status=TaskStatus(state=TaskState.COMPLETED, timestamp="2024-01-01T00:00:00Z"),
            history=[
                MessagePayload(role="user", parts=[TextPart(text="Question")]),
                MessagePayload(role="agent", parts=[TextPart(text="Answer from history")]),
            ],
        )
        
        result = get_task_response_text(task)
        
        assert result == "Answer from history"

    def test_returns_empty_string_when_no_text(self):
        """Should return empty string when no text found."""
        task = Task(
            id="task-123",
            contextId="ctx-456",
            status=TaskStatus(state=TaskState.COMPLETED, timestamp="2024-01-01T00:00:00Z"),
        )
        
        result = get_task_response_text(task)
        
        assert result == ""

    def test_task_get_response_text_method(self):
        """Should work via task method."""
        task = Task(
            id="task-123",
            contextId="ctx-456",
            status=TaskStatus(state=TaskState.COMPLETED, timestamp="2024-01-01T00:00:00Z"),
            artifacts=[
                Artifact(parts=[TextPart(text="Response")]),
            ],
        )
        
        result = task.get_response_text()
        
        assert result == "Response"


class TestUpdateCard:
    """Tests for update_card method - skipped due to WebSocket complexity."""

    @pytest.mark.skip(reason="WebSocket mocking requires integration test setup")
    @pytest.mark.asyncio
    async def test_update_card_when_connected(self):
        """Should send update_card message when connected."""
        pass

    @pytest.mark.asyncio
    async def test_update_card_stores_card(self):
        """Should store card even when not connected."""
        client = GopherHole("gph_test_key")
        
        await client.update_card({"name": "My Agent"})
        
        assert client.agent_card == {"name": "My Agent"}
