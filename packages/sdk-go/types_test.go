package gopherhole

import (
	"encoding/json"
	"testing"
)

func TestTaskState(t *testing.T) {
	t.Run("has all expected states", func(t *testing.T) {
		if TaskStateSubmitted != "submitted" {
			t.Error("expected TaskStateSubmitted to be 'submitted'")
		}
		if TaskStateWorking != "working" {
			t.Error("expected TaskStateWorking to be 'working'")
		}
		if TaskStateInputRequired != "input-required" {
			t.Error("expected TaskStateInputRequired to be 'input-required'")
		}
		if TaskStateCompleted != "completed" {
			t.Error("expected TaskStateCompleted to be 'completed'")
		}
		if TaskStateFailed != "failed" {
			t.Error("expected TaskStateFailed to be 'failed'")
		}
		if TaskStateCanceled != "canceled" {
			t.Error("expected TaskStateCanceled to be 'canceled'")
		}
		if TaskStateRejected != "rejected" {
			t.Error("expected TaskStateRejected to be 'rejected'")
		}
	})
}

func TestMessageRole(t *testing.T) {
	t.Run("has expected roles", func(t *testing.T) {
		if RoleUser != "user" {
			t.Error("expected RoleUser to be 'user'")
		}
		if RoleAgent != "agent" {
			t.Error("expected RoleAgent to be 'agent'")
		}
	})
}

func TestPartKind(t *testing.T) {
	t.Run("has expected kinds", func(t *testing.T) {
		if PartKindText != "text" {
			t.Error("expected PartKindText to be 'text'")
		}
		if PartKindFile != "file" {
			t.Error("expected PartKindFile to be 'file'")
		}
		if PartKindData != "data" {
			t.Error("expected PartKindData to be 'data'")
		}
	})
}

func TestTextPart(t *testing.T) {
	t.Run("creates text part", func(t *testing.T) {
		part := TextPart("Hello world")

		if part.Kind != PartKindText {
			t.Errorf("expected kind 'text', got %q", part.Kind)
		}
		if part.Text != "Hello world" {
			t.Errorf("expected text 'Hello world', got %q", part.Text)
		}
	})

	t.Run("serializes to JSON correctly", func(t *testing.T) {
		part := TextPart("Hello")
		data, err := json.Marshal(part)
		if err != nil {
			t.Fatalf("failed to marshal: %v", err)
		}

		var result map[string]interface{}
		json.Unmarshal(data, &result)

		if result["kind"] != "text" {
			t.Errorf("expected kind 'text', got %v", result["kind"])
		}
		if result["text"] != "Hello" {
			t.Errorf("expected text 'Hello', got %v", result["text"])
		}
	})
}

func TestFilePart(t *testing.T) {
	t.Run("creates file part", func(t *testing.T) {
		part := FilePart("document.pdf", "application/pdf", "base64data")

		if part.Kind != PartKindFile {
			t.Errorf("expected kind 'file', got %q", part.Kind)
		}
		if part.Name != "document.pdf" {
			t.Errorf("expected name 'document.pdf', got %q", part.Name)
		}
		if part.MimeType != "application/pdf" {
			t.Errorf("expected mimeType 'application/pdf', got %q", part.MimeType)
		}
		if part.Data != "base64data" {
			t.Errorf("expected data 'base64data', got %q", part.Data)
		}
	})
}

func TestMessagePayload(t *testing.T) {
	t.Run("creates message payload", func(t *testing.T) {
		payload := MessagePayload{
			Role: RoleUser,
			Parts: []MessagePart{
				TextPart("Hello"),
				TextPart("World"),
			},
		}

		if payload.Role != RoleUser {
			t.Errorf("expected role 'user', got %q", payload.Role)
		}
		if len(payload.Parts) != 2 {
			t.Errorf("expected 2 parts, got %d", len(payload.Parts))
		}
	})

	t.Run("serializes to JSON correctly", func(t *testing.T) {
		payload := MessagePayload{
			Role:  RoleAgent,
			Parts: []MessagePart{TextPart("Response")},
		}
		data, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("failed to marshal: %v", err)
		}

		var result map[string]interface{}
		json.Unmarshal(data, &result)

		if result["role"] != "agent" {
			t.Errorf("expected role 'agent', got %v", result["role"])
		}
	})
}

func TestTask(t *testing.T) {
	t.Run("parses from JSON", func(t *testing.T) {
		jsonData := `{
			"id": "task-123",
			"contextId": "ctx-456",
			"status": {
				"state": "completed",
				"timestamp": "2024-01-01T00:00:00Z"
			},
			"artifacts": [
				{
					"name": "response",
					"parts": [
						{"kind": "text", "text": "Hello from agent"}
					]
				}
			]
		}`

		var task Task
		if err := json.Unmarshal([]byte(jsonData), &task); err != nil {
			t.Fatalf("failed to unmarshal: %v", err)
		}

		if task.ID != "task-123" {
			t.Errorf("expected ID 'task-123', got %q", task.ID)
		}
		if task.ContextID != "ctx-456" {
			t.Errorf("expected ContextID 'ctx-456', got %q", task.ContextID)
		}
		if task.Status.State != "completed" {
			t.Errorf("expected state 'completed', got %q", task.Status.State)
		}
		if len(task.Artifacts) != 1 {
			t.Errorf("expected 1 artifact, got %d", len(task.Artifacts))
		}
	})
}

func TestTaskGetResponseText(t *testing.T) {
	t.Run("extracts text from artifacts", func(t *testing.T) {
		task := Task{
			ID:        "task-123",
			ContextID: "ctx-456",
			Status:    TaskStatus{State: TaskStateCompleted, Timestamp: "2024-01-01T00:00:00Z"},
			Artifacts: []Artifact{
				{
					Parts: []MessagePart{
						{Kind: PartKindText, Text: "First response"},
						{Kind: PartKindText, Text: "Second response"},
					},
				},
			},
		}

		result := task.GetResponseText()
		expected := "First response\nSecond response"
		if result != expected {
			t.Errorf("expected %q, got %q", expected, result)
		}
	})

	t.Run("falls back to messages", func(t *testing.T) {
		task := Task{
			ID:        "task-123",
			ContextID: "ctx-456",
			Status:    TaskStatus{State: TaskStateCompleted, Timestamp: "2024-01-01T00:00:00Z"},
			Messages: []MessagePayload{
				{Role: RoleUser, Parts: []MessagePart{TextPart("Question")}},
				{Role: RoleAgent, Parts: []MessagePart{TextPart("Answer from history")}},
			},
		}

		result := task.GetResponseText()
		if result != "Answer from history" {
			t.Errorf("expected 'Answer from history', got %q", result)
		}
	})

	t.Run("returns empty string when no text", func(t *testing.T) {
		task := Task{
			ID:        "task-123",
			ContextID: "ctx-456",
			Status:    TaskStatus{State: TaskStateCompleted, Timestamp: "2024-01-01T00:00:00Z"},
		}

		result := task.GetResponseText()
		if result != "" {
			t.Errorf("expected empty string, got %q", result)
		}
	})

	t.Run("skips non-text parts", func(t *testing.T) {
		task := Task{
			ID:        "task-123",
			ContextID: "ctx-456",
			Status:    TaskStatus{State: TaskStateCompleted, Timestamp: "2024-01-01T00:00:00Z"},
			Artifacts: []Artifact{
				{
					Parts: []MessagePart{
						{Kind: PartKindFile, MimeType: "image/png", Data: "base64..."},
						{Kind: PartKindText, Text: "Actual text"},
					},
				},
			},
		}

		result := task.GetResponseText()
		if result != "Actual text" {
			t.Errorf("expected 'Actual text', got %q", result)
		}
	})
}

func TestGetTaskResponseText(t *testing.T) {
	t.Run("works with helper function", func(t *testing.T) {
		task := &Task{
			ID:        "task-123",
			ContextID: "ctx-456",
			Status:    TaskStatus{State: TaskStateCompleted, Timestamp: "2024-01-01T00:00:00Z"},
			Artifacts: []Artifact{
				{Parts: []MessagePart{TextPart("Response")}},
			},
		}

		result := GetTaskResponseText(task)
		if result != "Response" {
			t.Errorf("expected 'Response', got %q", result)
		}
	})

	t.Run("handles nil task", func(t *testing.T) {
		result := GetTaskResponseText(nil)
		if result != "" {
			t.Errorf("expected empty string for nil task, got %q", result)
		}
	})
}

func TestPublicAgent(t *testing.T) {
	t.Run("parses from JSON", func(t *testing.T) {
		jsonData := `{
			"id": "agent-123",
			"name": "Test Agent",
			"description": "A test agent",
			"category": "utility",
			"tags": ["ai", "test"],
			"pricing": "free",
			"avgRating": 4.5,
			"ratingCount": 10,
			"tenantName": "Test Tenant"
		}`

		var agent PublicAgent
		if err := json.Unmarshal([]byte(jsonData), &agent); err != nil {
			t.Fatalf("failed to unmarshal: %v", err)
		}

		if agent.ID != "agent-123" {
			t.Errorf("expected ID 'agent-123', got %q", agent.ID)
		}
		if agent.AvgRating != 4.5 {
			t.Errorf("expected avgRating 4.5, got %f", agent.AvgRating)
		}
		if len(agent.Tags) != 2 {
			t.Errorf("expected 2 tags, got %d", len(agent.Tags))
		}
	})
}

func TestDiscoverResult(t *testing.T) {
	t.Run("parses from JSON", func(t *testing.T) {
		jsonData := `{
			"agents": [
				{"id": "agent-1", "name": "Agent 1"},
				{"id": "agent-2", "name": "Agent 2"}
			],
			"count": 2,
			"offset": 0
		}`

		var result DiscoverResult
		if err := json.Unmarshal([]byte(jsonData), &result); err != nil {
			t.Fatalf("failed to unmarshal: %v", err)
		}

		if len(result.Agents) != 2 {
			t.Errorf("expected 2 agents, got %d", len(result.Agents))
		}
		if result.Count != 2 {
			t.Errorf("expected count 2, got %d", result.Count)
		}
	})
}

func TestAgentCategory(t *testing.T) {
	t.Run("parses from JSON", func(t *testing.T) {
		jsonData := `{"name": "productivity", "count": 10}`

		var category AgentCategory
		if err := json.Unmarshal([]byte(jsonData), &category); err != nil {
			t.Fatalf("failed to unmarshal: %v", err)
		}

		if category.Name != "productivity" {
			t.Errorf("expected name 'productivity', got %q", category.Name)
		}
		if category.Count != 10 {
			t.Errorf("expected count 10, got %d", category.Count)
		}
	})
}

func TestAgentSkill(t *testing.T) {
	t.Run("parses from JSON", func(t *testing.T) {
		jsonData := `{
			"id": "summarize",
			"name": "Summarize",
			"description": "Summarizes text",
			"tags": ["nlp", "text"],
			"examples": ["Summarize this article"],
			"inputModes": ["text/plain"],
			"outputModes": ["text/markdown"]
		}`

		var skill AgentSkill
		if err := json.Unmarshal([]byte(jsonData), &skill); err != nil {
			t.Fatalf("failed to unmarshal: %v", err)
		}

		if skill.ID != "summarize" {
			t.Errorf("expected ID 'summarize', got %q", skill.ID)
		}
		if len(skill.Tags) != 2 {
			t.Errorf("expected 2 tags, got %d", len(skill.Tags))
		}
		if len(skill.InputModes) != 1 {
			t.Errorf("expected 1 input mode, got %d", len(skill.InputModes))
		}
	})
}

func TestAgentCard(t *testing.T) {
	t.Run("parses from JSON", func(t *testing.T) {
		jsonData := `{
			"name": "My Agent",
			"description": "An awesome agent",
			"url": "https://agent.example.com",
			"version": "1.0.0",
			"capabilities": {
				"streaming": true,
				"pushNotifications": false
			},
			"skills": [
				{"id": "s1", "name": "Skill 1"}
			]
		}`

		var card AgentCard
		if err := json.Unmarshal([]byte(jsonData), &card); err != nil {
			t.Fatalf("failed to unmarshal: %v", err)
		}

		if card.Name != "My Agent" {
			t.Errorf("expected name 'My Agent', got %q", card.Name)
		}
		if !card.Capabilities.Streaming {
			t.Error("expected streaming to be true")
		}
		if len(card.Skills) != 1 {
			t.Errorf("expected 1 skill, got %d", len(card.Skills))
		}
	})
}

func TestAgentInfo(t *testing.T) {
	t.Run("parses from JSON", func(t *testing.T) {
		jsonData := `{
			"agent": {
				"id": "agent-123",
				"name": "Test Agent"
			},
			"stats": {
				"avgRating": 4.5,
				"ratingCount": 10,
				"totalMessages": 1000,
				"successRate": 0.95,
				"avgResponseTime": 1500
			},
			"reviews": [
				{"rating": 5, "review": "Great!", "created_at": 1704067200, "reviewer_name": "John"}
			]
		}`

		var info AgentInfo
		if err := json.Unmarshal([]byte(jsonData), &info); err != nil {
			t.Fatalf("failed to unmarshal: %v", err)
		}

		if info.Agent.ID != "agent-123" {
			t.Errorf("expected agent ID 'agent-123', got %q", info.Agent.ID)
		}
		if info.Stats.AvgRating != 4.5 {
			t.Errorf("expected avgRating 4.5, got %f", info.Stats.AvgRating)
		}
		if len(info.Reviews) != 1 {
			t.Errorf("expected 1 review, got %d", len(info.Reviews))
		}
	})
}

func TestSendOptions(t *testing.T) {
	t.Run("serializes to JSON", func(t *testing.T) {
		opts := SendOptions{
			ContextID:           "ctx-123",
			PushNotificationURL: "https://callback.example.com",
			HistoryLength:       10,
		}

		data, err := json.Marshal(opts)
		if err != nil {
			t.Fatalf("failed to marshal: %v", err)
		}

		var result map[string]interface{}
		json.Unmarshal(data, &result)

		if result["contextId"] != "ctx-123" {
			t.Errorf("expected contextId 'ctx-123', got %v", result["contextId"])
		}
		if result["pushNotificationUrl"] != "https://callback.example.com" {
			t.Errorf("expected pushNotificationUrl, got %v", result["pushNotificationUrl"])
		}
	})
}

func TestDiscoverOptions(t *testing.T) {
	t.Run("has all fields", func(t *testing.T) {
		opts := DiscoverOptions{
			Query:       "weather",
			Category:    "utility",
			Tag:         "ai",
			SkillTag:    "summarization",
			ContentMode: "text/markdown",
			Sort:        "rating",
			Limit:       10,
			Offset:      20,
		}

		if opts.Query != "weather" {
			t.Errorf("expected Query 'weather', got %q", opts.Query)
		}
		if opts.SkillTag != "summarization" {
			t.Errorf("expected SkillTag 'summarization', got %q", opts.SkillTag)
		}
		if opts.ContentMode != "text/markdown" {
			t.Errorf("expected ContentMode 'text/markdown', got %q", opts.ContentMode)
		}
	})
}
