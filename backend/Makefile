APP_NAME  := vindrapay-go
CMD_DIR   := ./cmd/api
BIN_DIR   := ./bin

LDFLAGS   := -s -w
GOFLAGS   := -trimpath
BUILD_ENV := CGO_ENABLED=0

.DEFAULT_GOAL := help

## run: start the API locally (reads backend/.env)
.PHONY: run
run:
	go run $(CMD_DIR)

## build-linux: cross-compile static Linux binary
.PHONY: build-linux
build-linux:
	$(BUILD_ENV) GOOS=linux GOARCH=amd64 go build $(GOFLAGS) -ldflags "$(LDFLAGS)" -o $(BIN_DIR)/$(APP_NAME)-linux-amd64 $(CMD_DIR)

## build-windows: build Windows binary
.PHONY: build-windows
build-windows:
	$(BUILD_ENV) GOOS=windows GOARCH=amd64 go build $(GOFLAGS) -ldflags "$(LDFLAGS)" -o $(BIN_DIR)/$(APP_NAME)-windows-amd64.exe $(CMD_DIR)

## build-all: build for every supported platform
.PHONY: build-all
build-all: build-linux build-windows

## test: run all tests
.PHONY: test
test:
	go test ./...

## tidy: sync go.mod / go.sum
.PHONY: tidy
tidy:
	go mod tidy

## sqlc: regenerate database code from db/queries + db/migrations
.PHONY: sqlc
sqlc:
	sqlc generate

## clean: remove build artifacts
.PHONY: clean
clean:
	rm -rf $(BIN_DIR)

## help: show available targets
.PHONY: help
help:
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-14s\033[0m %s\n", $$1, $$2}'
