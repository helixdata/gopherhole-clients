"""Type definitions for the GopherHole SDK."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, Field


class TaskState(str, Enum):
    """Possible states for a task."""
    
    SUBMITTED = "submitted"
    WORKING = "working"
    INPUT_REQUIRED = "input-required"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELED = "canceled"
    REJECTED = "rejected"
    AUTH_REQUIRED = "auth-required"


class TextPart(BaseModel):
    """A text message part."""
    
    kind: Literal["text"] = "text"
    text: str


class FilePart(BaseModel):
    """A file message part."""
    
    kind: Literal["file"] = "file"
    name: Optional[str] = None
    mime_type: Optional[str] = Field(None, alias="mimeType")
    data: Optional[str] = None  # base64 encoded
    uri: Optional[str] = None

    class Config:
        populate_by_name = True


class DataPart(BaseModel):
    """A structured data message part."""
    
    kind: Literal["data"] = "data"
    mime_type: str = Field(alias="mimeType")
    data: str  # JSON string

    class Config:
        populate_by_name = True


MessagePart = Union[TextPart, FilePart, DataPart]


class MessagePayload(BaseModel):
    """A message payload containing role and parts."""
    
    role: Literal["user", "agent"]
    parts: list[MessagePart]
    metadata: Optional[dict[str, Any]] = None


class Message(BaseModel):
    """An incoming message from another agent."""
    
    from_agent: str = Field(alias="from")
    task_id: Optional[str] = Field(None, alias="taskId")
    payload: MessagePayload
    timestamp: int

    class Config:
        populate_by_name = True


class TaskStatus(BaseModel):
    """The status of a task."""
    
    state: TaskState
    timestamp: str
    message: Optional[str] = None


class Artifact(BaseModel):
    """An artifact produced by a task."""
    
    artifact_id: Optional[str] = Field(None, alias="artifactId")
    name: Optional[str] = None
    description: Optional[str] = None
    parts: list[MessagePart]
    index: Optional[int] = None
    append: Optional[bool] = None
    last_chunk: Optional[bool] = Field(None, alias="lastChunk")
    metadata: Optional[dict[str, Any]] = None

    class Config:
        populate_by_name = True


class Task(BaseModel):
    """A task representing a conversation/request."""
    
    id: str
    context_id: str = Field(alias="contextId")
    status: TaskStatus
    history: Optional[list[MessagePayload]] = None
    artifacts: Optional[list[Artifact]] = None
    metadata: Optional[dict[str, Any]] = None

    class Config:
        populate_by_name = True
    
    def get_response_text(self) -> str:
        """
        Extract text response from this task.
        
        Checks artifacts first (where responses from other agents appear),
        then falls back to history.
        
        Returns:
            The extracted text, or empty string if none found.
        """
        # Check artifacts first (this is where responses from other agents appear)
        if self.artifacts:
            texts = []
            for artifact in self.artifacts:
                for part in artifact.parts:
                    if hasattr(part, 'kind') and part.kind == 'text' and hasattr(part, 'text'):
                        texts.append(part.text)
            if texts:
                return '\n'.join(texts)
        
        # Fall back to history (last message)
        if self.history:
            last_message = self.history[-1]
            texts = []
            for part in last_message.parts:
                if hasattr(part, 'kind') and part.kind == 'text' and hasattr(part, 'text'):
                    texts.append(part.text)
            if texts:
                return '\n'.join(texts)
        
        return ''


def get_task_response_text(task: Task) -> str:
    """
    Extract text response from a completed task.
    
    Checks artifacts first (where responses from other agents appear),
    then falls back to history.
    
    Args:
        task: The task to extract text from.
    
    Returns:
        The extracted text, or empty string if none found.
    
    Example:
        task = await hub.send_text_and_wait("agent-id", "Hello!")
        response = get_task_response_text(task)
        print(response)
    """
    return task.get_response_text()


class SendOptions(BaseModel):
    """Options for sending a message."""
    
    context_id: Optional[str] = Field(None, alias="contextId")
    push_notification_url: Optional[str] = Field(None, alias="pushNotificationUrl")
    history_length: Optional[int] = Field(None, alias="historyLength")

    class Config:
        populate_by_name = True


class TaskListResult(BaseModel):
    """Result of listing tasks."""
    
    tasks: list[Task]
    next_page_token: Optional[str] = Field(None, alias="nextPageToken")
    total_size: int = Field(alias="totalSize")

    class Config:
        populate_by_name = True


class PushNotificationConfig(BaseModel):
    """Push notification configuration."""
    
    url: str
    token: Optional[str] = None
    authentication: Optional[dict[str, str]] = None


# ============================================================
# SKILL TYPES
# ============================================================

class AgentSkill(BaseModel):
    """A2A skill schema for agent capabilities."""
    
    id: str
    name: str
    description: Optional[str] = None
    tags: Optional[list[str]] = None
    examples: Optional[list[str]] = None
    input_modes: Optional[list[str]] = Field(None, alias="inputModes")
    output_modes: Optional[list[str]] = Field(None, alias="outputModes")

    class Config:
        populate_by_name = True


class AgentCapabilities(BaseModel):
    """Agent capabilities."""
    
    streaming: bool = False
    push_notifications: bool = Field(False, alias="pushNotifications")
    state_transition_history: bool = Field(False, alias="stateTransitionHistory")

    class Config:
        populate_by_name = True


class AgentProvider(BaseModel):
    """Agent provider info."""
    
    organization: str
    url: Optional[str] = None


class AgentCard(BaseModel):
    """Full A2A agent card."""
    
    name: str
    description: Optional[str] = None
    url: str
    provider: Optional[AgentProvider] = None
    version: str
    documentation_url: Optional[str] = Field(None, alias="documentationUrl")
    capabilities: AgentCapabilities
    skills: Optional[list[AgentSkill]] = None

    class Config:
        populate_by_name = True


# ============================================================
# DISCOVERY TYPES
# ============================================================

class PublicAgent(BaseModel):
    """A publicly discoverable agent."""
    
    id: str
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    tags: list[str] = []
    pricing: Literal["free", "paid", "contact"] = "free"
    avg_rating: float = Field(0, alias="avgRating")
    rating_count: int = Field(0, alias="ratingCount")
    tenant_name: str = Field(alias="tenantName")
    website_url: Optional[str] = Field(None, alias="websiteUrl")
    docs_url: Optional[str] = Field(None, alias="docsUrl")

    class Config:
        populate_by_name = True


class DiscoverResult(BaseModel):
    """Result from agent discovery."""
    
    agents: list[PublicAgent]
    count: int
    offset: int = 0


class AgentCategory(BaseModel):
    """An agent category."""
    
    name: str
    count: int


class AgentStats(BaseModel):
    """Agent statistics."""
    
    avg_rating: float = Field(alias="avgRating")
    rating_count: int = Field(alias="ratingCount")
    total_messages: int = Field(alias="totalMessages")
    success_rate: float = Field(alias="successRate")
    avg_response_time: float = Field(alias="avgResponseTime")

    class Config:
        populate_by_name = True


class AgentReview(BaseModel):
    """An agent review."""
    
    rating: int
    review: str
    created_at: int = Field(alias="created_at")
    reviewer_name: str = Field(alias="reviewer_name")

    class Config:
        populate_by_name = True


class AgentInfoResult(BaseModel):
    """Detailed agent info result."""
    
    agent: PublicAgent
    agent_card: Optional[AgentCard] = Field(None, alias="agentCard")
    stats: AgentStats
    reviews: list[AgentReview] = []

    class Config:
        populate_by_name = True
