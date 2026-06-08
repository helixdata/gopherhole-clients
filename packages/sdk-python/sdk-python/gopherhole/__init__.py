"""GopherHole SDK - Connect AI agents via the A2A protocol."""

from gopherhole.client import GopherHole
from gopherhole.transport import TransportMode
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
    # A2A extension types
    AgentExtension,
    AgentCapabilitiesWithExtensions,
    # UI extension types
    UI_EXTENSION_URI,
    UIExtensionParams,
    UIView,
    UIAction,
    UIField,
    UIFieldOption,
    UIColumn,
)

__version__ = "0.8.0"
__all__ = [
    "GopherHole",
    "TransportMode",
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
    # A2A extension types
    "AgentExtension",
    "AgentCapabilitiesWithExtensions",
    # UI extension types
    "UI_EXTENSION_URI",
    "UIExtensionParams",
    "UIView",
    "UIAction",
    "UIField",
    "UIFieldOption",
    "UIColumn",
]
