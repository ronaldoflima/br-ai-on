#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/lib/cli.sh"

# Estrutura: hub/plugins/<backend>/<plugin>/
# Retrocompat: se hub/plugins/<backend> não existe, cai em hub/plugins/claude
if [ -d "$ROOT/hub/plugins/$CLI_BACKEND" ]; then
  PLUGINS_DIR="$ROOT/hub/plugins/$CLI_BACKEND"
else
  PLUGINS_DIR="$ROOT/hub/plugins/claude"
fi

# Onde instalar commands: depende do backend (ex: ~/.claude/commands, ~/.codex/prompts)
# Retrocompat: se houver .claude/commands no repo, mantém (instalação legada local)
if [ -d "$ROOT/.claude/commands" ]; then
  COMMANDS_DIR="$ROOT/.claude/commands"
else
  COMMANDS_DIR=$(cli_commands_install_dir)
fi

usage() {
  cat <<'EOF'
Usage: hub.sh <command> [plugin]

Commands:
  list                 Lista plugins disponíveis
  installed            Lista plugins instalados
  install <plugin>     Instala ou atualiza plugin (só commands, preserva config)
  uninstall <plugin>   Remove plugin instalado (backup do config)
  status <plugin>      Mostra status do plugin
  init <plugin>        Instala + cria config a partir do example

Examples:
  hub.sh list
  hub.sh install tasks
  hub.sh init tasks
  hub.sh status tasks
  hub.sh uninstall tasks
EOF
}

get_manifest_field() {
  local manifest="$1" field="$2"
  grep -o "\"$field\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$manifest" | head -1 | cut -d'"' -f4
}

get_plugin_version() {
  local manifest="$1"
  get_manifest_field "$manifest" "version"
}

get_installed_version() {
  local target_dir="$1"
  local version_file="$target_dir/.version"
  [ -f "$version_file" ] && cat "$version_file" || echo ""
}

get_config_file() {
  local manifest="$1"
  get_manifest_field "$manifest" "file"
}

get_config_example() {
  local manifest="$1"
  get_manifest_field "$manifest" "example"
}

list_plugins() {
  echo "Plugins disponíveis em ${PLUGINS_DIR#$ROOT/}/:"
  echo ""
  for dir in "$PLUGINS_DIR"/*/; do
    [ -d "$dir" ] || continue
    local name manifest version desc installed_ver status_icon
    name="$(basename "$dir")"
    manifest="$dir/manifest.json"
    if [ -f "$manifest" ]; then
      version=$(get_plugin_version "$manifest")
      desc=$(get_manifest_field "$manifest" "description")
      installed_ver=$(get_installed_version "$COMMANDS_DIR/$name")
      if [ -z "$installed_ver" ]; then
        status_icon=""
      elif [ "$installed_ver" = "$version" ]; then
        status_icon=" [v$installed_ver ✅]"
      else
        status_icon=" [v$installed_ver → v$version ⬆️]"
      fi
      printf "  %-15s v%-8s %s%s\n" "$name" "$version" "$desc" "$status_icon"
    else
      printf "  %-15s (sem manifest)\n" "$name"
    fi
  done
}

list_installed() {
  echo "Plugins instalados em $COMMANDS_DIR/:"
  echo ""
  local found=0
  for dir in "$COMMANDS_DIR"/*/; do
    [ -d "$dir" ] || continue
    local name plugin_dir installed_ver plugin_ver config_status config_file
    name="$(basename "$dir")"
    plugin_dir="$PLUGINS_DIR/$name"
    if [ -d "$plugin_dir" ] && [ -f "$plugin_dir/manifest.json" ]; then
      installed_ver=$(get_installed_version "$dir")
      plugin_ver=$(get_plugin_version "$plugin_dir/manifest.json")
      config_file=$(get_config_file "$plugin_dir/manifest.json")
      config_status=""
      if [ -n "$config_file" ]; then
        if [ -f "$dir/$config_file" ]; then
          config_status=" (config: ✅)"
        else
          config_status=" (config: ❌)"
        fi
      fi
      local ver_display="${installed_ver:-?}"
      local update_hint=""
      [ -n "$installed_ver" ] && [ "$installed_ver" != "$plugin_ver" ] && update_hint=" → v$plugin_ver disponível"
      printf "  %-15s v%-8s%s%s\n" "$name" "$ver_display" "$config_status" "$update_hint"
      found=1
    fi
  done
  [ "$found" -eq 0 ] && echo "  (nenhum)"
}

install_plugin() {
  local name="$1"
  local plugin_dir="$PLUGINS_DIR/$name"
  local target_dir="$COMMANDS_DIR/$name"

  if [ ! -d "$plugin_dir" ]; then
    echo "❌ Plugin '$name' não encontrado em ${PLUGINS_DIR#$ROOT/}/"
    exit 1
  fi

  if [ ! -f "$plugin_dir/manifest.json" ]; then
    echo "❌ Plugin '$name' não tem manifest.json"
    exit 1
  fi

  local plugin_ver installed_ver
  plugin_ver=$(get_plugin_version "$plugin_dir/manifest.json")
  installed_ver=$(get_installed_version "$target_dir")

  if [ "$installed_ver" = "$plugin_ver" ]; then
    echo "✅ Plugin '$name' já está na versão v$plugin_ver"
    return 0
  fi

  if [ -n "$installed_ver" ]; then
    echo "⬆️  Atualizando '$name' v$installed_ver → v$plugin_ver"
  else
    echo "📦 Instalando '$name' v$plugin_ver"
  fi

  mkdir -p "$target_dir"

  if [ -d "$plugin_dir/commands" ]; then
    local existing_mds
    existing_mds=$(find "$target_dir" -maxdepth 1 -name "*.md" -type f 2>/dev/null || true)
    if [ -n "$existing_mds" ]; then
      echo "$existing_mds" | while read -r f; do rm -f "$f"; done
    fi
    cp "$plugin_dir/commands/"*.md "$target_dir/" 2>/dev/null || true
  fi

  echo "$plugin_ver" > "$target_dir/.version"

  local count
  count=$(find "$target_dir" -maxdepth 1 -name "*.md" -type f | wc -l)
  echo "✅ Plugin '$name' v$plugin_ver ($count commands)"

  local config_file
  config_file=$(get_config_file "$plugin_dir/manifest.json")
  if [ -n "$config_file" ] && [ ! -f "$target_dir/$config_file" ]; then
    echo "⚠️  Config não encontrado. Execute: hub.sh init $name"
  fi
}

init_plugin() {
  local name="$1"
  local plugin_dir="$PLUGINS_DIR/$name"
  local target_dir="$COMMANDS_DIR/$name"

  install_plugin "$name"

  local example config_file
  example=$(get_config_example "$plugin_dir/manifest.json")
  config_file=$(get_config_file "$plugin_dir/manifest.json")

  if [ -n "$example" ] && [ -n "$config_file" ] && [ -f "$plugin_dir/$example" ]; then
    if [ -f "$target_dir/$config_file" ]; then
      echo "📋 Config já existe: $target_dir/$config_file (preservado)"
    else
      cp "$plugin_dir/$example" "$target_dir/$config_file"
      echo "📋 Config criado: $target_dir/$config_file"
      local post_install
      post_install=$(get_manifest_field "$plugin_dir/manifest.json" "post_install")
      [ -n "$post_install" ] && echo "💡 $post_install"
    fi
  fi
}

uninstall_plugin() {
  local name="$1"
  local plugin_dir="$PLUGINS_DIR/$name"
  local target_dir="$COMMANDS_DIR/$name"

  if [ ! -d "$target_dir" ]; then
    echo "❌ Plugin '$name' não está instalado"
    exit 1
  fi

  local config_file=""
  if [ -f "$plugin_dir/manifest.json" ]; then
    config_file=$(get_config_file "$plugin_dir/manifest.json")
  fi

  local backup_dir="/tmp/hub-backup-${name}-$(date +%Y%m%d%H%M%S)"
  local backed_up=0

  if [ -n "$config_file" ] && [ -f "$target_dir/$config_file" ]; then
    mkdir -p "$backup_dir"
    cp "$target_dir/$config_file" "$backup_dir/"
    echo "📋 Config salvo em $backup_dir/$config_file"
    backed_up=1
  fi

  for f in "$target_dir"/*.json; do
    [ -f "$f" ] || continue
    [ "$(basename "$f")" = "$config_file" ] && continue
    mkdir -p "$backup_dir"
    cp "$f" "$backup_dir/"
    backed_up=1
  done

  [ "$backed_up" -eq 1 ] && echo "💾 Backup em $backup_dir/"

  rm -rf "$target_dir"
  echo "✅ Plugin '$name' desinstalado"
}

status_plugin() {
  local name="$1"
  local plugin_dir="$PLUGINS_DIR/$name"
  local target_dir="$COMMANDS_DIR/$name"

  if [ ! -d "$plugin_dir" ]; then
    echo "❌ Plugin '$name' não encontrado em ${PLUGINS_DIR#$ROOT/}/"
    exit 1
  fi

  echo "📦 Plugin: $name"

  local plugin_ver=""
  if [ -f "$plugin_dir/manifest.json" ]; then
    plugin_ver=$(get_plugin_version "$plugin_dir/manifest.json")
    local desc
    desc=$(get_manifest_field "$plugin_dir/manifest.json" "description")
    echo "   Descrição: $desc"
    echo "   Versão disponível: v$plugin_ver"
  fi

  if [ -d "$target_dir" ]; then
    local installed_ver count
    installed_ver=$(get_installed_version "$target_dir")
    count=$(find "$target_dir" -maxdepth 1 -name "*.md" -type f | wc -l)
    echo "   Instalado: ✅ v${installed_ver:-?} ($count commands)"
    if [ -n "$installed_ver" ] && [ -n "$plugin_ver" ] && [ "$installed_ver" != "$plugin_ver" ]; then
      echo "   ⬆️  Atualização disponível: v$installed_ver → v$plugin_ver"
    fi
  else
    echo "   Instalado: ❌"
  fi

  local config_file=""
  if [ -f "$plugin_dir/manifest.json" ]; then
    config_file=$(get_config_file "$plugin_dir/manifest.json")
  fi
  if [ -n "$config_file" ]; then
    if [ -f "$target_dir/$config_file" ]; then
      echo "   Config: ✅ ($config_file)"
    else
      echo "   Config: ❌ (execute hub.sh init $name)"
    fi
  fi
}

case "${1:-}" in
  list)       list_plugins ;;
  installed)  list_installed ;;
  install)    [ -z "${2:-}" ] && { echo "❌ Uso: hub.sh install <plugin>"; exit 1; }; install_plugin "$2" ;;
  init)       [ -z "${2:-}" ] && { echo "❌ Uso: hub.sh init <plugin>"; exit 1; }; init_plugin "$2" ;;
  uninstall)  [ -z "${2:-}" ] && { echo "❌ Uso: hub.sh uninstall <plugin>"; exit 1; }; uninstall_plugin "$2" ;;
  status)     [ -z "${2:-}" ] && { echo "❌ Uso: hub.sh status <plugin>"; exit 1; }; status_plugin "$2" ;;
  *)          usage ;;
esac
