// Copy this file to secrets.h (git-ignored) and fill in your network.
#pragma once

#define WIFI_SSID "your-network"
#define WIFI_PASSWORD "your-password"

// Dashboard upload. Leave DASHBOARD_URL empty to keep the board standalone.
// Live cameras > Add board camera shows these lines filled in, once.
#define DASHBOARD_URL ""
#define DEVICE_ID ""
#define DEVICE_TOKEN ""
// Caddy's root certificate. In dashboard/: docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt
// Paste its lines (BEGIN to END CERTIFICATE) between the two lines below.
static const char DASHBOARD_CA[] = R"PEM(
)PEM";
