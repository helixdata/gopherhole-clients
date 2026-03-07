.PHONY: test test-verbose test-coverage lint build clean

# Run tests
test:
	go test ./... -v

# Run tests with verbose output
test-verbose:
	go test ./... -v -count=1

# Run tests with coverage
test-coverage:
	go test ./... -v -coverprofile=coverage.out
	go tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report generated: coverage.html"

# Run linter (requires golangci-lint)
lint:
	golangci-lint run

# Build (check compilation)
build:
	go build ./...

# Clean generated files
clean:
	rm -f coverage.out coverage.html

# Run all checks
check: lint test
