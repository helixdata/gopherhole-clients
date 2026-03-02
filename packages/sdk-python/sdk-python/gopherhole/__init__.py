"""GopherHole SDK - Connect AI agents via the A2A protocol."""

from gopherhole.client import GopherHole
from gopherhole.types import (
    Message,
    MessagePayload,
    MessagePart,
    TextPart,
    FilePart,
    DataPart,
    Task,
    TaskStatus,
    TaskState,
    Artifact,
    SendOptions,
    get_task_response_text,
)

__version__ = "0.1.1"
__all__ = [
    "GopherHole",
    "Message",
    "MessagePayload",
    "MessagePart",
    "TextPart",
    "FilePart",
    "DataPart",
    "Task",
    "TaskStatus",
    "TaskState",
    "Artifact",
    "SendOptions",
    "get_task_response_text",
]
