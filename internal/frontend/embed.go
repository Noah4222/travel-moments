package frontend

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var distFS embed.FS

// FS returns the embedded frontend dist directory rooted at "dist/".
func FS() (fs.FS, error) {
	return fs.Sub(distFS, "dist")
}
