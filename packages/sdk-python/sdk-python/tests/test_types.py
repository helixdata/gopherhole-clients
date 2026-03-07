"""Tests for gopherhole types."""

import pytest
from gopherhole.types import (
    TaskState,
    TextPart,
    FilePart,
    DataPart,
    MessagePayload,
    Message,
    TaskStatus,
    Artifact,
    Task,
    SendOptions,
    TaskListResult,
    PublicAgent,
    DiscoverResult,
    AgentCategory,
    AgentSkill,
    AgentCard,
    AgentCapabilities,
    AgentStats,
    AgentReview,
    AgentInfoResult,
)


class TestTaskState:
    """Tests for TaskState enum."""

    def test_task_states(self):
        """Should have all expected task states."""
        assert TaskState.SUBMITTED == "submitted"
        assert TaskState.WORKING == "working"
        assert TaskState.INPUT_REQUIRED == "input-required"
        assert TaskState.COMPLETED == "completed"
        assert TaskState.FAILED == "failed"
        assert TaskState.CANCELED == "canceled"
        assert TaskState.REJECTED == "rejected"
        assert TaskState.AUTH_REQUIRED == "auth-required"


class TestMessageParts:
    """Tests for message part types."""

    def test_text_part(self):
        """Should create text part."""
        part = TextPart(text="Hello")
        assert part.kind == "text"
        assert part.text == "Hello"

    def test_file_part(self):
        """Should create file part."""
        part = FilePart(name="document.pdf", mime_type="application/pdf", uri="https://example.com/file.pdf")
        assert part.kind == "file"
        assert part.name == "document.pdf"
        assert part.mime_type == "application/pdf"

    def test_data_part(self):
        """Should create data part."""
        part = DataPart(mime_type="image/png", data="base64data")
        assert part.kind == "data"
        assert part.mime_type == "image/png"
        assert part.data == "base64data"


class TestMessagePayload:
    """Tests for MessagePayload."""

    def test_message_payload(self):
        """Should create message payload."""
        payload = MessagePayload(
            role="user",
            parts=[TextPart(text="Hello")],
        )
        assert payload.role == "user"
        assert len(payload.parts) == 1


class TestMessage:
    """Tests for Message."""

    def test_message_with_alias(self):
        """Should handle field aliases."""
        msg = Message(
            **{
                "from": "agent-123",
                "taskId": "task-456",
                "payload": MessagePayload(role="user", parts=[TextPart(text="Hi")]),
                "timestamp": 1704067200,
            }
        )
        assert msg.from_agent == "agent-123"
        assert msg.task_id == "task-456"


class TestTask:
    """Tests for Task model."""

    def test_task_creation(self):
        """Should create task from dict."""
        task = Task(
            id="task-123",
            contextId="ctx-456",
            status=TaskStatus(state=TaskState.COMPLETED, timestamp="2024-01-01T00:00:00Z"),
        )
        assert task.id == "task-123"
        assert task.context_id == "ctx-456"
        assert task.status.state == TaskState.COMPLETED

    def test_task_with_artifacts(self):
        """Should handle artifacts."""
        task = Task(
            id="task-123",
            contextId="ctx-456",
            status=TaskStatus(state=TaskState.COMPLETED, timestamp="2024-01-01T00:00:00Z"),
            artifacts=[
                Artifact(parts=[TextPart(text="Response")]),
            ],
        )
        assert len(task.artifacts) == 1
        assert task.artifacts[0].parts[0].text == "Response"

    def test_task_get_response_text_from_artifacts(self):
        """Should extract text from artifacts."""
        task = Task(
            id="task-123",
            contextId="ctx-456",
            status=TaskStatus(state=TaskState.COMPLETED, timestamp="2024-01-01T00:00:00Z"),
            artifacts=[
                Artifact(parts=[TextPart(text="First"), TextPart(text="Second")]),
            ],
        )
        assert task.get_response_text() == "First\nSecond"

    def test_task_get_response_text_from_history(self):
        """Should fall back to history."""
        task = Task(
            id="task-123",
            contextId="ctx-456",
            status=TaskStatus(state=TaskState.COMPLETED, timestamp="2024-01-01T00:00:00Z"),
            history=[
                MessagePayload(role="user", parts=[TextPart(text="Question")]),
                MessagePayload(role="agent", parts=[TextPart(text="Answer")]),
            ],
        )
        assert task.get_response_text() == "Answer"

    def test_task_get_response_text_empty(self):
        """Should return empty string when no text."""
        task = Task(
            id="task-123",
            contextId="ctx-456",
            status=TaskStatus(state=TaskState.COMPLETED, timestamp="2024-01-01T00:00:00Z"),
        )
        assert task.get_response_text() == ""


class TestSendOptions:
    """Tests for SendOptions."""

    def test_send_options(self):
        """Should create send options."""
        opts = SendOptions(context_id="ctx-123", history_length=10)
        assert opts.context_id == "ctx-123"
        assert opts.history_length == 10

    def test_send_options_alias_serialization(self):
        """Should serialize with aliases."""
        opts = SendOptions(context_id="ctx-123")
        data = opts.model_dump(by_alias=True, exclude_none=True)
        assert "contextId" in data
        assert data["contextId"] == "ctx-123"


class TestTaskListResult:
    """Tests for TaskListResult."""

    def test_task_list_result(self):
        """Should create task list result."""
        result = TaskListResult(
            tasks=[
                Task(id="t1", contextId="c1", status=TaskStatus(state=TaskState.COMPLETED, timestamp="2024-01-01T00:00:00Z")),
            ],
            totalSize=1,
        )
        assert len(result.tasks) == 1
        assert result.total_size == 1


class TestPublicAgent:
    """Tests for PublicAgent."""

    def test_public_agent(self):
        """Should create public agent."""
        agent = PublicAgent(
            id="agent-123",
            name="Test Agent",
            description="A test agent",
            category="utility",
            tags=["ai", "test"],
            pricing="free",
            avgRating=4.5,
            ratingCount=10,
            tenantName="Test Tenant",
        )
        assert agent.id == "agent-123"
        assert agent.avg_rating == 4.5
        assert agent.rating_count == 10

    def test_public_agent_defaults(self):
        """Should have sensible defaults."""
        agent = PublicAgent(
            id="agent-123",
            name="Test",
            tenantName="Tenant",
        )
        assert agent.pricing == "free"
        assert agent.avg_rating == 0
        assert agent.tags == []


class TestDiscoverResult:
    """Tests for DiscoverResult."""

    def test_discover_result(self):
        """Should create discover result."""
        result = DiscoverResult(
            agents=[PublicAgent(id="a1", name="Agent 1", tenantName="t1")],
            count=1,
            offset=0,
        )
        assert len(result.agents) == 1
        assert result.count == 1


class TestAgentCategory:
    """Tests for AgentCategory."""

    def test_agent_category(self):
        """Should create agent category."""
        category = AgentCategory(name="productivity", count=10)
        assert category.name == "productivity"
        assert category.count == 10


class TestAgentSkill:
    """Tests for AgentSkill."""

    def test_agent_skill(self):
        """Should create agent skill."""
        skill = AgentSkill(
            id="summarize",
            name="Summarize",
            description="Summarizes text",
            tags=["nlp", "text"],
            examples=["Summarize this article"],
            input_modes=["text/plain"],
            output_modes=["text/markdown"],
        )
        assert skill.id == "summarize"
        assert "nlp" in skill.tags
        assert "text/plain" in skill.input_modes


class TestAgentCard:
    """Tests for AgentCard."""

    def test_agent_card(self):
        """Should create agent card."""
        card = AgentCard(
            name="My Agent",
            description="An awesome agent",
            url="https://agent.example.com",
            version="1.0.0",
            capabilities=AgentCapabilities(streaming=True),
            skills=[
                AgentSkill(id="s1", name="Skill 1"),
            ],
        )
        assert card.name == "My Agent"
        assert card.capabilities.streaming is True
        assert len(card.skills) == 1


class TestAgentCapabilities:
    """Tests for AgentCapabilities."""

    def test_agent_capabilities(self):
        """Should create agent capabilities."""
        caps = AgentCapabilities(
            streaming=True,
            push_notifications=True,
            state_transition_history=False,
        )
        assert caps.streaming is True
        assert caps.push_notifications is True
        assert caps.state_transition_history is False

    def test_agent_capabilities_defaults(self):
        """Should have false defaults."""
        caps = AgentCapabilities()
        assert caps.streaming is False
        assert caps.push_notifications is False


class TestAgentStats:
    """Tests for AgentStats."""

    def test_agent_stats(self):
        """Should create agent stats."""
        stats = AgentStats(
            avgRating=4.5,
            ratingCount=100,
            totalMessages=5000,
            successRate=0.95,
            avgResponseTime=1500,
        )
        assert stats.avg_rating == 4.5
        assert stats.rating_count == 100
        assert stats.success_rate == 0.95


class TestAgentReview:
    """Tests for AgentReview."""

    def test_agent_review(self):
        """Should create agent review."""
        review = AgentReview(
            rating=5,
            review="Great agent!",
            created_at=1704067200,
            reviewer_name="John Doe",
        )
        assert review.rating == 5
        assert review.review == "Great agent!"


class TestAgentInfoResult:
    """Tests for AgentInfoResult."""

    def test_agent_info_result(self):
        """Should create agent info result."""
        result = AgentInfoResult(
            agent=PublicAgent(id="a1", name="Agent", tenantName="t1"),
            stats=AgentStats(avgRating=4.5, ratingCount=10, totalMessages=100, successRate=0.9, avgResponseTime=1000),
            reviews=[],
        )
        assert result.agent.id == "a1"
        assert result.stats.avg_rating == 4.5
