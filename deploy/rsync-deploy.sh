#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

script_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(CDPATH= cd -- "${script_dir}/.." && pwd)
state_root=${XDG_STATE_HOME:-${HOME}/.local/state}
state_dir=${state_root}/dicefront
state_file=${state_dir}/rsync-deploy.conf

fail() {
  printf 'Fehler: %s\n' "$*" >&2
  exit 1
}

command -v rsync >/dev/null 2>&1 || fail "rsync wurde lokal nicht gefunden."
command -v ssh >/dev/null 2>&1 || fail "ssh wurde lokal nicht gefunden."

last_destination=''
last_ssh_port=''
if [[ -f "$state_file" ]]; then
  while IFS='=' read -r key value; do
    case "$key" in
      destination) last_destination=$value ;;
      ssh_port) last_ssh_port=$value ;;
    esac
  done < "$state_file"
fi

printf '\nDicefront: interaktives Deployment\n'
printf 'Lokales Projekt: %s\n\n' "$repo_root"

if [[ -n "$last_destination" ]]; then
  read -r -p "Rsync-Ziel [${last_destination}]: " destination
  destination=${destination:-$last_destination}
else
  read -r -p 'Rsync-Ziel ([user@]server:/absoluter/pfad): ' destination
fi
[[ -n "$destination" ]] || fail "Kein Ziel angegeben."

remote_host=${destination%%:*}
remote_path=${destination#*:}
[[ "$remote_host" != "$destination" ]] || fail "Ziel muss das Format [user@]server:/absoluter/pfad verwenden."
[[ -n "$remote_host" && "$remote_path" == /* ]] || fail "Der Remote-Pfad muss absolut sein, zum Beispiel /var/www/dicefront."
[[ "$remote_host" != *[[:space:]]* ]] || fail "Der Servername darf keine Leerzeichen enthalten."

if [[ -n "$last_ssh_port" ]]; then
  read -r -p "SSH-Port [${last_ssh_port}]: " ssh_port
  ssh_port=${ssh_port:-$last_ssh_port}
else
  read -r -p 'SSH-Port [22]: ' ssh_port
  ssh_port=${ssh_port:-22}
fi
[[ "$ssh_port" =~ ^[0-9]+$ && "$ssh_port" -ge 1 && "$ssh_port" -le 65535 ]] || fail "Ungültiger SSH-Port."

mkdir -p -- "$state_dir"
{
  printf 'destination=%s\n' "$destination"
  printf 'ssh_port=%s\n' "$ssh_port"
} > "$state_file"

printf '\nÜbertragen werden:\n'
printf '  index.html, styles.css, assets/, src/, server/\n'
printf '  package.json, package-lock.json, deploy/, README.md, LICENSE\n'
printf 'Ausgeschlossen werden: .git, node_modules, Tests, Vorgabebilder und lokale Build-/Coverage-Daten.\n'
printf 'Es wird kein --delete verwendet; zusätzliche Dateien am Ziel bleiben erhalten.\n\n'

read -r -p "Nach ${remote_host}:${remote_path} übertragen? [j/N]: " confirmation
case "$confirmation" in
  j|J|ja|JA|y|Y|yes|YES) ;;
  *) printf 'Abgebrochen.\n'; exit 0 ;;
esac

remote_path_q=$(printf '%q' "$remote_path")
remote_path_sed=${remote_path//\\/\\\\}
remote_path_sed=${remote_path_sed//&/\\&}
remote_path_sed=${remote_path_sed//#/\\#}
printf '\nRemote-Verzeichnis wird geprüft …\n'
ssh -p "$ssh_port" "$remote_host" "mkdir -p -- ${remote_path_q}"

printf 'Dateien werden übertragen …\n'
rsync \
  --archive \
  --compress \
  --human-readable \
  --info=progress2 \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='tests/' \
  --exclude='Vorgabe/' \
  --exclude='coverage/' \
  --exclude='playwright-report/' \
  --exclude='test-results/' \
  -e "ssh -p ${ssh_port}" \
  "${repo_root}/" \
  "${destination%/}/"

printf '\nÜbertragung abgeschlossen.\n'
printf '\nNächste Schritte auf dem Zielserver:\n\n'
printf '1) In das Projekt wechseln und Produktionsabhängigkeiten installieren:\n'
printf '   cd %q\n' "$remote_path"
printf '   npm ci --omit=dev\n\n'

printf '2) Multiplayer-Service mit dem tatsächlichen Projektpfad installieren:\n'
printf '   sudo sed "s#^WorkingDirectory=.*#WorkingDirectory=%s#" deploy/dicefront-multiplayer.service | sudo tee /etc/systemd/system/dicefront-multiplayer.service >/dev/null\n' "$remote_path_sed"
printf '   sudo systemctl daemon-reload\n'
printf '   sudo systemctl enable --now dicefront-multiplayer\n'
printf '   sudo systemctl status dicefront-multiplayer --no-pager\n\n'

printf '3) nginx-Konfiguration innerhalb des bestehenden HTTPS-server-Blocks einbinden:\n'
printf '   sudo cp deploy/nginx-multiplayer.conf /etc/nginx/snippets/dicefront-multiplayer.conf\n'
printf '   sudo nginx -t\n'
printf '   sudo systemctl reload nginx\n\n'

printf '4) Verbindung prüfen:\n'
printf '   journalctl -u dicefront-multiplayer -n 50 --no-pager\n'
printf '   Die WebSocket-URL lautet: wss://<host>/codex/WorldWarsThree/ws\n\n'

printf 'Hinweis: Das Skript führt keine sudo-Befehle auf dem Zielserver aus.\n'
printf 'Die letzten Eingaben werden lokal unter %s gespeichert (ohne Passwörter oder SSH-Schlüssel).\n' "$state_file"
