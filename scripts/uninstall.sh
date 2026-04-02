#!/bin/bash

SERVICE_FILE="$HOME/.config/systemd/user/braion.service"

if [ ! -f "$SERVICE_FILE" ]; then
  echo "braion.service não encontrado, nada a fazer."
  exit 0
fi

systemctl --user stop braion.service 2>/dev/null || true
systemctl --user disable braion.service 2>/dev/null || true
rm -f "$SERVICE_FILE"
systemctl --user daemon-reload
systemctl --user reset-failed 2>/dev/null || true

echo "braion.service removido."
