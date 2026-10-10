// NestTrace ESP32-S3 camera for the Freenove ESP32-S3 WROOM board.
// Arduino IDE > Tools: Board "ESP32S3 Dev Module", PSRAM "OPI PSRAM", Flash Size matching your module.
// Copy secrets.example.h to secrets.h and set your Wi-Fi before uploading. See README.md.

#include <Arduino.h>
#include <WiFi.h>
#include "camera.h"
#include "console.h"
#include "secrets.h"
#include "uplink.h"
#include "web_server.h"

namespace
{
    bool cameraReady = false;
    bool serversStarted = false;
    bool uplinkStarted = false;
    volatile bool gotAddress = false;

    // Tells you up front whether the board can see the network at all (2.4 GHz only).
    void reportNetworkVisibility()
    {
        CONSOLE("Scanning for \"%s\" ...\n", WIFI_SSID);
        const int count = WiFi.scanNetworks();
        for (int i = 0; i < count; i++)
        {
            if (WiFi.SSID(i) == WIFI_SSID)
            {
                CONSOLE("  found on channel %d, signal %d dBm\n", WiFi.channel(i), WiFi.RSSI(i));
                WiFi.scanDelete();
                return;
            }
        }
        CONSOLE("  not found among %d networks. Is the hotspot on and set to 2.4 GHz?\n", count);
        WiFi.scanDelete();
    }

    void onWifiEvent(WiFiEvent_t event, WiFiEventInfo_t info)
    {
        switch (event)
        {
        case ARDUINO_EVENT_WIFI_STA_GOT_IP:
            gotAddress = true;
            break;
        case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
        {
            const auto reason = static_cast<wifi_err_reason_t>(info.wifi_sta_disconnected.reason);
            CONSOLE("Wi-Fi not connected: %s (%d). Retrying automatically.\n",
                          WiFi.disconnectReasonName(reason), static_cast<int>(reason));
            break;
        }
        default:
            break;
        }
    }

    void startWifi()
    {
        WiFi.mode(WIFI_STA);
        WiFi.setSleep(false);         // power save adds latency spikes to the stream
        WiFi.setAutoReconnect(true);  // the driver retries on its own; never call reconnect() while it does
        WiFi.onEvent(onWifiEvent);
        reportNetworkVisibility();
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }

    void announce()
    {
        const String ip = WiFi.localIP().toString();
        CONSOLE("Wi-Fi connected, signal %d dBm\n", WiFi.RSSI());
        CONSOLE("Camera page:   http://%s/\n", ip.c_str());
        CONSOLE("Snapshot:      http://%s/capture\n", ip.c_str());
        CONSOLE("Status (JSON): http://%s/status\n", ip.c_str());
        CONSOLE("MJPEG stream:  http://%s:81/stream\n", ip.c_str());
        CONSOLE("Dashboard:     %s\n", uplink::status().state);
    }
}

void setup()
{
    Serial.begin(115200);
    delay(1500);
    CONSOLE("\nNestTrace ESP32-S3 camera starting\n");
    uplink::useTlsMemoryInPsram();  // before Wi-Fi: TLS must not take the internal RAM the camera and Wi-Fi need

    // Camera first: the raw-mode frame buffer needs a large block of internal RAM before Wi-Fi takes its share.
    cameraReady = cameraBegin() && cameraStartCapture();
    if (!cameraReady)
    {
        CONSOLE("Stopped: camera not usable.\n");
        return;
    }
    startWifi();
}

void loop()
{
    // The address can arrive late (hotspot switched on after boot) or again after a drop.
    if (cameraReady && gotAddress)
    {
        gotAddress = false;
        if (!serversStarted)
        {
            serversStarted = webServerBegin();
            if (!serversStarted)
            {
                CONSOLE("Web server failed to start; press reset.\n");
            }
        }
        if (serversStarted)
        {
            if (!uplinkStarted)
            {
                uplinkStarted = true;
                uplink::begin();
            }
            announce();
        }
    }
    delay(100);
}
