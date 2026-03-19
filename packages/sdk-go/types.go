// Package gopherhole provides a Go SDK for the GopherHole A2A protocol hub.
package gopherhole

import (
	"encoding/json"
	"time"
)

// TaskState represents the current state of a task.
type TaskState string

const (
	TaskStateSubmitted     TaskState = "submitted"
	TaskStateWorking       TaskState = "working"
	TaskStateInputRequired TaskState = "input-required"
	TaskStateCompleted     TaskState = "completed"
	TaskStateFailed        TaskState = "failed"
	TaskStateCanceled      TaskState = "canceled"
	TaskStateRejected      TaskState = "rejected"
)

// MessageRole indicates who sent the message.
type MessageRole string

const (
	RoleUser  MessageRole = "user"
	RoleAgent MessageRole = "agent"
)

// PartKind indicates the type of message part.
type PartKind string

const (
	PartKindText PartKind = "text"
	PartKindFile PartKind = "file"
	PartKindData PartKind = "data"
)

// MessagePart represents a single part of a message.
type MessagePart struct {
	Kind     PartKind `json:"kind"`
	Text     string   `json:"text,omitempty"`
	MimeType string   `json:"mimeType,omitempty"`
	Data     string   `json:"data,omitempty"` // Base64 encoded
	URI      string   `json:"uri,omitempty"`
	Name     string   `json:"name,omitempty"` // For files
}

// TextPart creates a text message part.
func TextPart(text string) MessagePart {
	return MessagePart{Kind: PartKindText, Text: text}
}

// FilePart creates a file message part.
func FilePart(name, mimeType, data string) MessagePart {
	return MessagePart{Kind: PartKindFile, Name: name, MimeType: mimeType, Data: data}
}

// MessagePayload represents the content of a message.
type MessagePayload struct {
	Role  MessageRole   `json:"role"`
	Parts []MessagePart `json:"parts"`
}

// TaskStatus represents the current status of a task.
type TaskStatus struct {
	State     TaskState `json:"state"`
	Timestamp string    `json:"timestamp"`
	Message   string    `json:"message,omitempty"`
}

// Artifact represents an output artifact from a task.
type Artifact struct {
	ID       string        `json:"id,omitempty"`
	Name     string        `json:"name"`
	MimeType string        `json:"mimeType"`
	Parts    []MessagePart `json:"parts,omitempty"`
	Data     string        `json:"data,omitempty"`
	URI      string        `json:"uri,omitempty"`
}

// Task represents an A2A task.
type Task struct {
	ID        string           `json:"id"`
	ContextID string           `json:"contextId"`
	Status    TaskStatus       `json:"status"`
	Messages  []MessagePayload `json:"messages,omitempty"`
	Artifacts []Artifact       `json:"artifacts,omitempty"`
}

// GetResponseText extracts the text response from this task.
// It checks artifacts first (where responses from other agents appear),
// then falls back to the last message in Messages.
func (t *Task) GetResponseText() string {
	// Check artifacts first (where responses from other agents appear)
	if len(t.Artifacts) > 0 {
		var texts []string
		for _, artifact := range t.Artifacts {
			for _, part := range artifact.Parts {
				if part.Kind == PartKindText && part.Text != "" {
					texts = append(texts, part.Text)
				}
			}
		}
		if len(texts) > 0 {
			result := ""
			for i, text := range texts {
				if i > 0 {
					result += "\n"
				}
				result += text
			}
			return result
		}
	}

	// Fall back to Messages (last message)
	if len(t.Messages) > 0 {
		lastMsg := t.Messages[len(t.Messages)-1]
		var texts []string
		for _, part := range lastMsg.Parts {
			if part.Kind == PartKindText && part.Text != "" {
				texts = append(texts, part.Text)
			}
		}
		if len(texts) > 0 {
			result := ""
			for i, text := range texts {
				if i > 0 {
					result += "\n"
				}
				result += text
			}
			return result
		}
	}

	return ""
}

// GetTaskResponseText extracts the text response from a completed task.
// This is a convenience function that calls task.GetResponseText().
func GetTaskResponseText(task *Task) string {
	if task == nil {
		return ""
	}
	return task.GetResponseText()
}

// Message represents an incoming message from the WebSocket.
type Message struct {
	From      string         `json:"from"`
	TaskID    string         `json:"taskId,omitempty"`
	Payload   MessagePayload `json:"payload"`
	Timestamp time.Time      `json:"timestamp"`
}

// SendOptions contains options for sending a message.
type SendOptions struct {
	ContextID           string `json:"contextId,omitempty"`
	PushNotificationURL string `json:"pushNotificationUrl,omitempty"`
	HistoryLength       int    `json:"historyLength,omitempty"`
}

// DiscoverOptions contains options for discovering agents.
type DiscoverOptions struct {
	Query       string `json:"query,omitempty"`
	Category    string `json:"category,omitempty"`
	Tag         string `json:"tag,omitempty"`
	SkillTag    string `json:"skillTag,omitempty"`    // Filter by skill tag
	ContentMode string `json:"contentMode,omitempty"` // Filter by MIME type
	Sort        string `json:"sort,omitempty"`        // "rating", "popular", "recent"
	Limit       int    `json:"limit,omitempty"`
	Offset      int    `json:"offset,omitempty"`
}

// AgentSkill represents an A2A skill with rich schema.
type AgentSkill struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"`
	Tags        []string `json:"tags,omitempty"`
	Examples    []string `json:"examples,omitempty"`
	InputModes  []string `json:"inputModes,omitempty"`  // MIME types
	OutputModes []string `json:"outputModes,omitempty"` // MIME types
}

// AgentCapabilities represents what an agent can do.
type AgentCapabilities struct {
	Streaming              bool `json:"streaming,omitempty"`
	PushNotifications      bool `json:"pushNotifications,omitempty"`
	StateTransitionHistory bool `json:"stateTransitionHistory,omitempty"`
}

// AgentProvider represents the organization providing an agent.
type AgentProvider struct {
	Organization string `json:"organization"`
	URL          string `json:"url,omitempty"`
}

// AgentCard represents a full A2A agent card.
type AgentCard struct {
	Name             string            `json:"name"`
	Description      string            `json:"description,omitempty"`
	URL              string            `json:"url"`
	Provider         *AgentProvider    `json:"provider,omitempty"`
	Version          string            `json:"version"`
	DocumentationURL string            `json:"documentationUrl,omitempty"`
	Capabilities     AgentCapabilities `json:"capabilities"`
	Skills           []AgentSkill      `json:"skills,omitempty"`
}

// PublicAgent represents a publicly discoverable agent.
type PublicAgent struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Category    string   `json:"category"`
	Tags        []string `json:"tags"`
	Pricing     string   `json:"pricing"`
	AvgRating   float64  `json:"avgRating"`
	RatingCount int      `json:"ratingCount"`
	TenantName  string   `json:"tenantName"`
	WebsiteURL  string   `json:"websiteUrl"`
	DocsURL     string   `json:"docsUrl"`
}

// DiscoverResult contains the results of an agent discovery query.
type DiscoverResult struct {
	Agents []PublicAgent `json:"agents"`
	Count  int           `json:"count"`
	Offset int           `json:"offset"`
}

// AgentCategory represents a category of agents.
type AgentCategory struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// AgentReview represents a review of an agent.
type AgentReview struct {
	Rating       int    `json:"rating"`
	Review       string `json:"review"`
	CreatedAt    int64  `json:"created_at"`
	ReviewerName string `json:"reviewer_name"`
}

// AgentStats contains statistics about an agent.
type AgentStats struct {
	AvgRating       float64 `json:"avgRating"`
	RatingCount     int     `json:"ratingCount"`
	TotalMessages   int     `json:"totalMessages"`
	SuccessRate     float64 `json:"successRate"`
	AvgResponseTime int     `json:"avgResponseTime"` // milliseconds
}

// AgentInfo contains detailed information about an agent.
type AgentInfo struct {
	Agent     PublicAgent   `json:"agent"`
	AgentCard *AgentCard    `json:"agentCard,omitempty"`
	Stats     AgentStats    `json:"stats"`
	Reviews   []AgentReview `json:"reviews"`
}

// JSON-RPC types (internal)

type jsonRPCRequest struct {
	JSONRPC string      `json:"jsonrpc"`
	Method  string      `json:"method"`
	Params  interface{} `json:"params"`
	ID      int64       `json:"id"`
}

type jsonRPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *jsonRPCError   `json:"error,omitempty"`
	ID      int64           `json:"id"`
}

type jsonRPCError struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

// WebSocket message types (internal)

type wsMessage struct {
	Type      string          `json:"type"`
	From      string          `json:"from,omitempty"`
	TaskID    string          `json:"taskId,omitempty"`
	Payload   json.RawMessage `json:"payload,omitempty"`
	Task      *Task           `json:"task,omitempty"`
	AgentID   string          `json:"agentId,omitempty"`
	Timestamp int64           `json:"timestamp,omitempty"`
}

// ============================================================
// WORKSPACE TYPES (GopherHole Extension)
// ============================================================

// MemoryType represents the type of a workspace memory.
type MemoryType string

const (
	MemoryTypeFact       MemoryType = "fact"
	MemoryTypeDecision   MemoryType = "decision"
	MemoryTypePreference MemoryType = "preference"
	MemoryTypeTodo       MemoryType = "todo"
	MemoryTypeContext    MemoryType = "context"
	MemoryTypeReference  MemoryType = "reference"
)

// WorkspaceRole represents a member's role in a workspace.
type WorkspaceRole string

const (
	WorkspaceRoleRead  WorkspaceRole = "read"
	WorkspaceRoleWrite WorkspaceRole = "write"
	WorkspaceRoleAdmin WorkspaceRole = "admin"
)

// Workspace represents a shared workspace for agent collaboration.
type Workspace struct {
	ID           string        `json:"id"`
	OwnerAgentID string        `json:"owner_agent_id"`
	Name         string        `json:"name"`
	Description  string        `json:"description,omitempty"`
	CreatedAt    int64         `json:"created_at"`
	UpdatedAt    int64         `json:"updated_at"`
	MemberCount  int           `json:"member_count,omitempty"`
	MemoryCount  int           `json:"memory_count,omitempty"`
	MyRole       WorkspaceRole `json:"my_role,omitempty"`
}

// WorkspaceMember represents a member of a workspace.
type WorkspaceMember struct {
	AgentID   string        `json:"agent_id"`
	AgentName string        `json:"agent_name,omitempty"`
	Role      WorkspaceRole `json:"role"`
	AddedAt   int64         `json:"added_at"`
}

// WorkspaceMemory represents a memory stored in a workspace.
type WorkspaceMemory struct {
	ID           string     `json:"id"`
	WorkspaceID  string     `json:"workspace_id"`
	Content      string     `json:"content"`
	Type         MemoryType `json:"type"`
	Tags         []string   `json:"tags"`
	Links        []string   `json:"links"`
	Similarity   float64    `json:"similarity,omitempty"`
	Confidence   float64    `json:"confidence,omitempty"`
	SourceTaskID string     `json:"source_task_id,omitempty"`
	CreatedAt    int64      `json:"created_at"`
	CreatedBy    string     `json:"created_by,omitempty"`
	UpdatedAt    int64      `json:"updated_at,omitempty"`
	UpdatedBy    string     `json:"updated_by,omitempty"`
}

// WorkspaceStoreParams contains parameters for storing a memory.
type WorkspaceStoreParams struct {
	WorkspaceID  string     `json:"workspace_id"`
	Content      string     `json:"content"`
	Type         MemoryType `json:"type"`
	Tags         []string   `json:"tags,omitempty"`
	Links        []string   `json:"links,omitempty"`
	SourceTaskID string     `json:"source_task_id,omitempty"`
	Confidence   float64    `json:"confidence,omitempty"`
}

// WorkspaceQueryParams contains parameters for querying memories.
type WorkspaceQueryParams struct {
	WorkspaceID string     `json:"workspace_id"`
	Query       string     `json:"query"`
	Type        MemoryType `json:"type,omitempty"`
	Limit       int        `json:"limit,omitempty"`
	Threshold   float64    `json:"threshold,omitempty"`
	Tags        []string   `json:"tags,omitempty"`
}

// WorkspaceUpdateParams contains parameters for updating a memory.
type WorkspaceUpdateParams struct {
	WorkspaceID string     `json:"workspace_id"`
	ID          string     `json:"id"`
	Content     string     `json:"content,omitempty"`
	Type        MemoryType `json:"type,omitempty"`
	Tags        []string   `json:"tags,omitempty"`
}

// WorkspaceListMemoriesParams contains parameters for listing memories.
type WorkspaceListMemoriesParams struct {
	WorkspaceID string     `json:"workspace_id"`
	Limit       int        `json:"limit,omitempty"`
	Offset      int        `json:"offset,omitempty"`
	Type        MemoryType `json:"type,omitempty"`
	Tags        []string   `json:"tags,omitempty"`
}

// WorkspaceMemoriesResult contains the result of listing workspace memories.
type WorkspaceMemoriesResult struct {
	Memories []WorkspaceMemory `json:"memories"`
	Count    int               `json:"count"`
	Total    int               `json:"total"`
}
