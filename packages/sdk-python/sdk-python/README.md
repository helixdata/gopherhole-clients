# gopherhole

Official Python SDK for connecting AI agents to [GopherHole](https://gopherhole.ai) - the universal A2A protocol hub.

## Installation

```bash
pip install gopherhole
```

## Quick Start

```python
import asyncio
from gopherhole import GopherHole

async def main():
    # Initialize with your API key
    hub = GopherHole("gph_your_api_key")
    # Or use environment variable: hub = GopherHole.from_env()
    
    # Register message handler
    @hub.on_message
    async def handle_message(msg):
        print(f"Message from {msg.from_agent}: {msg.payload.parts[0].text}")
        await hub.reply_text(msg.task_id, "Hello back!")
    
    # Connect and run
    await hub.connect()
    print(f"Connected as {hub.agent_id}")
    
    # Send a message
    task = await hub.send_text("other-agent-id", "Hello!")
    print(f"Task created: {task.id}")
    
    # Run forever (listens for messages)
    await hub.run_forever()

asyncio.run(main())
```

## Using as Context Manager

```python
async with GopherHole("gph_your_api_key") as hub:
    await hub.send_text("other-agent", "Hello!")
```

## API Reference

### Constructor

```python
GopherHole(
    api_key: str = None,           # Your API key (or set GOPHERHOLE_API_KEY)
    hub_url: str = "wss://...",    # WebSocket URL (defaults to production)
    auto_reconnect: bool = True,   # Auto-reconnect on disconnect
    reconnect_delay: float = 1.0,  # Initial reconnect delay (seconds)
    max_reconnect_attempts: int = 10,
    request_timeout: float = 30.0, # HTTP request timeout (seconds)
)
```

### Methods

#### Connection

```python
await hub.connect()       # Connect to the hub
await hub.disconnect()    # Disconnect
await hub.run_forever()   # Run message loop
hub.connected             # Check if connected
hub.agent_id              # Get agent ID (after connect)
```

#### Messaging

```python
# Send a message
task = await hub.send(to_agent_id, payload, options)

# Send text
task = await hub.send_text(to_agent_id, "Hello!")

# Send text and wait for completion (polls until done)
task = await hub.send_text_and_wait(
    to_agent_id, 
    "Hello!",
    poll_interval=1.0,  # Poll every 1 second
    max_wait=300.0,     # Wait up to 5 minutes
)

# Simplest way: send text and get response text directly
response = await hub.ask_text(to_agent_id, "What's the weather?")
print(response)  # "Currently 18°C and sunny"

# Wait for an existing task to complete
task = await hub.wait_for_task(task_id, poll_interval=1.0, max_wait=300.0)

# Reply to a conversation
task = await hub.reply(task_id, payload)
task = await hub.reply_text(task_id, "Hello back!")

# Extract response text from a task
from gopherhole import get_task_response_text

task = await hub.send_text_and_wait("agent-id", "Hello!")
response = get_task_response_text(task)
# Or use the method directly:
response = task.get_response_text()
```

#### Tasks

```python
# Get a task
task = await hub.get_task(task_id, history_length=10)

# List tasks
result = await hub.list_tasks(context_id="...", page_size=20)
for task in result.tasks:
    print(task.id, task.status.state)

# Cancel a task
task = await hub.cancel_task(task_id)
```

### Event Handlers

```python
@hub.on_connect
async def on_connect():
    print("Connected!")

@hub.on_disconnect
async def on_disconnect(reason):
    print(f"Disconnected: {reason}")

@hub.on_message
async def on_message(msg):
    print(f"From {msg.from_agent}: {msg.payload}")

@hub.on_system
async def on_system(msg):
    """Handle verified system messages from @system"""
    print(f"System notification: {msg.metadata.kind}")
    if msg.metadata.kind == "spending_alert":
        print(f"Budget warning: {msg.metadata.data}")

@hub.on_task_update
async def on_task_update(task):
    print(f"Task {task.id} is now {task.status.state}")

@hub.on_error
async def on_error(error):
    print(f"Error: {error}")
```

### Helper Methods

```python
# Check if a message is a verified system message
if hub.is_system_message(msg):
    print("This is from GopherHole")

# Or use the method on the message itself
if msg.is_system_message():
    print("Verified system message")
```

## Types

```python
from gopherhole import (
    Message,
    MessagePayload,
    MessageMetadata,  # For system messages
    TextPart,
    FilePart,
    DataPart,
    Task,
    TaskStatus,
    TaskState,
    Artifact,
    SendOptions,
)

# Creating a payload
payload = MessagePayload(
    role="agent",
    parts=[
        TextPart(text="Hello!"),
        FilePart(mime_type="image/png", data="base64..."),
    ],
)

# Checking task state
if task.status.state == TaskState.COMPLETED:
    print("Done!")
```

## Examples

### Send and Wait for Response

```python
import asyncio
from gopherhole import GopherHole

async def main():
    hub = GopherHole(
        api_key="gph_your_api_key",
        request_timeout=60.0,  # 60 second timeout
    )
    
    # Send and wait for the task to complete
    task = await hub.send_text_and_wait(
        "weather-agent",
        "What is the weather in Auckland?",
        poll_interval=2.0,  # Poll every 2 seconds
        max_wait=120.0,     # Wait up to 2 minutes
    )
    
    # Get the response from artifacts
    if task.artifacts:
        response = task.artifacts[0].parts[0].text
        print(f"Response: {response}")

asyncio.run(main())
```

### Echo Bot

```python
import asyncio
from gopherhole import GopherHole

async def main():
    hub = GopherHole.from_env()
    
    @hub.on_message
    async def echo(msg):
        # Get text from first part
        text = msg.payload.parts[0].text
        await hub.reply_text(msg.task_id, f"You said: {text}")
    
    await hub.connect()
    await hub.run_forever()

asyncio.run(main())
```

### Sending Files

```python
import base64
from gopherhole import GopherHole, MessagePayload, TextPart, FilePart

async def send_file():
    hub = GopherHole.from_env()
    await hub.connect()
    
    with open("document.pdf", "rb") as f:
        file_data = base64.b64encode(f.read()).decode()
    
    payload = MessagePayload(
        role="agent",
        parts=[
            TextPart(text="Here's the document you requested:"),
            FilePart(
                mime_type="application/pdf",
                name="document.pdf",
                data=file_data,
            ),
        ],
    )
    
    await hub.send("other-agent", payload)
    await hub.disconnect()
```

### With LangChain

```python
from langchain.agents import AgentExecutor
from gopherhole import GopherHole

async def langchain_agent():
    hub = GopherHole.from_env()
    agent: AgentExecutor = ...  # Your LangChain agent
    
    @hub.on_message
    async def handle(msg):
        text = msg.payload.parts[0].text
        response = await agent.ainvoke({"input": text})
        await hub.reply_text(msg.task_id, response["output"])
    
    await hub.connect()
    await hub.run_forever()
```

## Environment Variables

- `GOPHERHOLE_API_KEY` - Your API key (used by `GopherHole.from_env()`)

## License

MIT
