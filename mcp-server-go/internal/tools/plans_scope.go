package tools

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/Chachamaru127/harness-mem/mcp-server-go/internal/util"
)

type plansTarget struct {
	ProjectRoot string
	PlansPath   string
	Source      string
}

func resolvePlansTarget(args map[string]any) (plansTarget, string) {
	cwd := strings.TrimSpace(argString(args, "cwd"))
	project := strings.TrimSpace(argString(args, "project"))
	plansPathArg := strings.TrimSpace(argString(args, "plans_path"))

	var scopedRoot string
	var source string

	if cwd != "" {
		if !filepath.IsAbs(cwd) {
			return plansTarget{}, "invalid_scope: cwd must be an absolute path"
		}
		realCwd, ok := realpathExistingDir(cwd)
		if !ok {
			return plansTarget{}, "invalid_scope: cwd must be an existing directory"
		}
		scopedRoot = util.GetProjectRootFrom(realCwd)
		source = "cwd"
	} else if project != "" {
		if !filepath.IsAbs(project) {
			return plansTarget{}, "invalid_scope: project must be an absolute filesystem path for Plans.md operations; pass cwd for short project keys"
		}
		realProject, ok := realpathExistingDir(project)
		if !ok {
			return plansTarget{}, "invalid_scope: project must be an existing directory"
		}
		scopedRoot = util.GetProjectRootFrom(realProject)
		source = "project"
	}

	if plansPathArg != "" {
		if !filepath.IsAbs(plansPathArg) {
			return plansTarget{}, "invalid_scope: plans_path must be an absolute path"
		}
		if filepath.Base(plansPathArg) != "Plans.md" {
			return plansTarget{}, "invalid_scope: plans_path must point to a Plans.md file"
		}
		parent, ok := realpathExistingDir(filepath.Dir(plansPathArg))
		if !ok {
			return plansTarget{}, "invalid_scope: plans_path parent must be an existing directory"
		}
		projectRoot := scopedRoot
		if projectRoot == "" {
			projectRoot = util.GetProjectRootFrom(parent)
		}
		realRoot, ok := realpathExistingDir(projectRoot)
		if !ok {
			return plansTarget{}, "invalid_scope: resolved project root must be an existing directory"
		}
		plansPath, errText := resolveSafePlansPath(filepath.Join(parent, "Plans.md"), realRoot)
		if errText != "" {
			return plansTarget{}, errText
		}
		return plansTarget{ProjectRoot: realRoot, PlansPath: plansPath, Source: "plans_path"}, ""
	}

	if scopedRoot == "" || source == "" {
		return plansTarget{}, "scope_required: pass cwd, an absolute filesystem project path, or plans_path so Plans.md file operations do not use the MCP server cwd"
	}

	realRoot, ok := realpathExistingDir(scopedRoot)
	if !ok {
		return plansTarget{}, "invalid_scope: resolved project root must be an existing directory"
	}
	plansPath, errText := resolveSafePlansPath(filepath.Join(realRoot, "Plans.md"), realRoot)
	if errText != "" {
		return plansTarget{}, errText
	}
	return plansTarget{ProjectRoot: realRoot, PlansPath: plansPath, Source: source}, ""
}

func realpathExistingDir(dir string) (string, bool) {
	real, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return "", false
	}
	abs, err := filepath.Abs(real)
	if err != nil {
		return "", false
	}
	info, err := os.Stat(abs)
	if err != nil || !info.IsDir() {
		return "", false
	}
	return abs, true
}

func isSubpathOrEqual(child, parent string) bool {
	rel, err := filepath.Rel(parent, child)
	if err != nil {
		return false
	}
	return rel == "." || (rel != "" && !strings.HasPrefix(rel, "..") && !filepath.IsAbs(rel))
}

func resolveSafePlansPath(plansPath string, realRoot string) (string, string) {
	parent, ok := realpathExistingDir(filepath.Dir(plansPath))
	if !ok {
		return "", "invalid_scope: Plans.md parent must be an existing directory"
	}
	normalizedPlansPath := filepath.Join(parent, "Plans.md")
	if info, err := os.Lstat(normalizedPlansPath); err == nil {
		if info.IsDir() {
			return "", "invalid_scope: Plans.md path must not be a directory"
		}
		realFile, err := filepath.EvalSymlinks(normalizedPlansPath)
		if err != nil {
			return "", "invalid_scope: Plans.md realpath could not be resolved"
		}
		realFileAbs, err := filepath.Abs(realFile)
		if err != nil {
			return "", "invalid_scope: Plans.md realpath could not be resolved"
		}
		if !isSubpathOrEqual(realFileAbs, realRoot) {
			return "", "invalid_scope: Plans.md realpath must stay within the resolved project root"
		}
	} else if !os.IsNotExist(err) {
		return "", "invalid_scope: Plans.md path could not be inspected"
	} else if !isSubpathOrEqual(normalizedPlansPath, realRoot) {
		return "", "invalid_scope: plans_path must stay within the resolved project root"
	}
	return normalizedPlansPath, ""
}
