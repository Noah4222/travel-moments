# syntax=docker/dockerfile:1.7

# ---- frontend build (Vite + Bun) ---------------------------------------------
FROM oven/bun:1 AS web
WORKDIR /src
# bun install first (cacheable layer)
COPY web/package.json web/bun.lock ./web/
RUN cd web && bun install --frozen-lockfile
# build (vite writes to ../internal/frontend/dist so the Go //go:embed picks it up)
COPY web/ ./web/
COPY internal/frontend/ ./internal/frontend/
RUN cd web && bun run build

# ---- backend build (Go, CGO disabled) ----------------------------------------
FROM golang:1.26 AS gobuild
WORKDIR /src
ENV CGO_ENABLED=0 GOFLAGS=-trimpath
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
# overlay the built frontend produced by the web stage
COPY --from=web /src/internal/frontend/dist ./internal/frontend/dist
ARG VERSION=dev
RUN go build -ldflags="-s -w -X main.version=${VERSION}" -o /out/server ./cmd/server

# ---- runtime image (distroless static) ---------------------------------------
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=gobuild /out/server /app/server
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/app/server"]
