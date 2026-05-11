.DEFAULT_GOAL := help

SHELL := /bin/bash
AIR := $(shell command -v air 2>/dev/null)

.PHONY: help install-tools dev dev-back dev-front build test clean

help: ## 列出可用命令
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install-tools: ## 安装本地开发工具（air）
	@if [ -z "$(AIR)" ]; then \
		echo "→ installing github.com/air-verse/air@latest"; \
		go install github.com/air-verse/air@latest; \
	else \
		echo "✓ air already installed at $(AIR)"; \
	fi

dev-back: ## 后端热重载（air）
	@if ! command -v air >/dev/null 2>&1; then \
		echo "air not found. run: make install-tools"; exit 1; \
	fi
	set -a; [ -f .env ] && source .env; set +a; air

dev-front: ## 前端 vite dev server (proxy /api → :18888)
	cd web && bun dev

dev: ## 同时跑前后端，Ctrl-C 退出两个
	@$(MAKE) -j2 dev-back dev-front

build: ## 一次性 build 前端 + 后端二进制
	cd web && bun run build
	go build -o ./bin/server ./cmd/server

test: ## 跑全部 Go 测试
	go test ./...

clean: ## 清理产物
	rm -rf bin tmp build-errors.log
