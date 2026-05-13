package oss

import (
	"fmt"
	"strings"
)

// EditOp is one step in a chain of admin photo edits. Each kind maps to the
// matching 阿里云 OSS image-process operator. Inputs are validated to keep
// out-of-range values from reaching OSS (which returns opaque 400s).
type EditOp struct {
	Kind string `json:"kind"`
	// rotate
	Deg int `json:"deg,omitempty"`
	// crop — pixel coordinates in the *output of preceding ops* (i.e. after
	// auto-orient + rotate, matching what the user sees in the editor).
	X int `json:"x,omitempty"`
	Y int `json:"y,omitempty"`
	W int `json:"w,omitempty"`
	H int `json:"h,omitempty"`
	// bright / contrast / sharpen scalar
	V int `json:"v,omitempty"`
}

// BuildEditProcess turns an op list into an OSS image-process spec. The spec
// already includes the leading `image/` segment and always starts with
// `auto-orient,1` so EXIF rotation is baked in before any user-coord op runs.
//
// The returned string is the value passed to `?x-oss-process=`.
func BuildEditProcess(ops []EditOp) (string, error) {
	parts := []string{"image/auto-orient,1"}
	for _, op := range ops {
		s, err := opToProcess(op)
		if err != nil {
			return "", err
		}
		if s != "" {
			parts = append(parts, s)
		}
	}
	if len(parts) == 1 {
		return "", fmt.Errorf("no-op edit: nothing to do")
	}
	return strings.Join(parts, "/"), nil
}

func opToProcess(op EditOp) (string, error) {
	switch op.Kind {
	case "rotate":
		// OSS accepts 0..360. Normalise multiples of 360 to a no-op.
		deg := op.Deg % 360
		if deg < 0 {
			deg += 360
		}
		if deg == 0 {
			return "", nil
		}
		return fmt.Sprintf("rotate,%d", deg), nil
	case "crop":
		if op.W <= 0 || op.H <= 0 {
			return "", fmt.Errorf("crop requires positive w/h")
		}
		if op.X < 0 || op.Y < 0 {
			return "", fmt.Errorf("crop x/y must be non-negative")
		}
		return fmt.Sprintf("crop,x_%d,y_%d,w_%d,h_%d", op.X, op.Y, op.W, op.H), nil
	case "bright":
		if op.V < -100 || op.V > 100 {
			return "", fmt.Errorf("bright must be in [-100, 100]")
		}
		if op.V == 0 {
			return "", nil
		}
		return fmt.Sprintf("bright,%d", op.V), nil
	case "contrast":
		if op.V < -100 || op.V > 100 {
			return "", fmt.Errorf("contrast must be in [-100, 100]")
		}
		if op.V == 0 {
			return "", nil
		}
		return fmt.Sprintf("contrast,%d", op.V), nil
	case "sharpen":
		// OSS sharpen accepts 50..399. We let UI send 0 to mean "no sharpen".
		if op.V == 0 {
			return "", nil
		}
		if op.V < 50 || op.V > 399 {
			return "", fmt.Errorf("sharpen must be in [50, 399] or 0")
		}
		return fmt.Sprintf("sharpen,%d", op.V), nil
	case "blur":
		// blur,r_<radius>,s_<sigma>; radius 1..50, sigma 1..50.
		if op.W <= 0 && op.H <= 0 {
			return "", nil
		}
		r, s := op.W, op.H
		if r < 1 || r > 50 || s < 1 || s > 50 {
			return "", fmt.Errorf("blur r/s must be in [1, 50]")
		}
		return fmt.Sprintf("blur,r_%d,s_%d", r, s), nil
	}
	return "", fmt.Errorf("unknown op kind %q", op.Kind)
}
