#!/usr/bin/env sh

set -eu

repo_root=$(git rev-parse --show-toplevel 2>/dev/null || printf '')

if [ -z "$repo_root" ]; then
  echo "Project Brain: not inside a git repository." >&2
  exit 1
fi

hooks_dir="$repo_root/.git/hooks"
hook_path="$hooks_dir/post-commit"
backup_path="$hooks_dir/post-commit.project-brain.bak"

mkdir -p "$hooks_dir"

if [ -f "$hook_path" ] && ! grep -q "project-brain post-commit hook" "$hook_path"; then
  cp "$hook_path" "$backup_path"
fi

cat > "$hook_path" <<'EOF'
#!/usr/bin/env sh

# project-brain post-commit hook
# Lightweight Codex workflow amplifier: extract repo knowledge from
# the latest commit context when the `brain` command is available.

if ! command -v brain >/dev/null 2>&1; then
  exit 0
fi

brain extract-commit >/dev/null 2>&1 || true

exit 0
EOF

chmod +x "$hook_path"

echo "Installed Project Brain post-commit hook at $hook_path"
if [ -f "$backup_path" ]; then
  echo "Existing hook was backed up to $backup_path"
fi
