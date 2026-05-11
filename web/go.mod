// This file exists only to exclude web/ (and its node_modules) from the parent
// Go module, so `go test ./...` doesn't traverse it.
module github.com/cloverstd/travel-moments/_web_isolation

go 1.21
