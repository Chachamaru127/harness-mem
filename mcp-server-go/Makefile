.PHONY: build build-stripped test cross clean install

MODULE := github.com/Chachamaru127/harness-mem/mcp-server-go
BIN := bin/harness-mcp-server

build:
	go build -o $(BIN) ./main.go

build-stripped:
	go build -ldflags="-s -w" -o $(BIN) ./main.go

test:
	go test ./...

cross:
	GOOS=darwin  GOARCH=arm64 go build -ldflags="-s -w" -o bin/harness-mcp-darwin-arm64 ./main.go
	GOOS=darwin  GOARCH=amd64 go build -ldflags="-s -w" -o bin/harness-mcp-darwin-amd64 ./main.go
	GOOS=linux   GOARCH=amd64 go build -ldflags="-s -w" -o bin/harness-mcp-linux-amd64  ./main.go
	GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o bin/harness-mcp-windows-amd64.exe ./main.go

install: build-stripped
	@OS=$$(uname -s | tr '[:upper:]' '[:lower:]'); \
	ARCH=$$(uname -m); \
	case $$ARCH in x86_64) ARCH=amd64;; aarch64) ARCH=arm64;; esac; \
	TARGET="../bin/harness-mcp-$${OS}-$${ARCH}"; \
	TMP="../bin/.harness-mcp-$${OS}-$${ARCH}.tmp"; \
	cp $(BIN) "$$TMP"; \
	chmod +x "$$TMP"; \
	mv "$$TMP" "$$TARGET"; \
	echo "Installed to ../bin/harness-mcp-$${OS}-$${ARCH}"

clean:
	rm -rf bin/
