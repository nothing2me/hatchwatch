// NestTrace ESP32-S3 camera for the Freenove ESP32-S3 WROOM board.
// Arduino IDE > Tools: Board "ESP32S3 Dev Module", PSRAM "OPI PSRAM", Flash Size matching your module.
// Copy secrets.example.h to secrets.h and set your Wi-Fi before uploading. See README.md.

#include <Arduino.h>
#include <WiFi.h>
#include "camera.h"
#include "secrets.h"
#include "web_server.h"

namespace
{
    bool cameraReady = false;
    bool serversStarted = false;
    volatile bool gotAddress = false;

    // Tells you up front whether the board can see the network at all (2.4 GHz only).
    void reportNetworkVisibility()
    {
        Serial.printf("Scanning for \"%s\" ...\n", WIFI_SSID);
        const int count = WiFi.scanNetworks();
        for (int i = 0; i < count; i++)
        {
            if (WiFi.SSID(i) == WIFI_SSID)
            {
                Serial.printf("  found on channel %d, signal %d dBm\n", WiFi.channel(i), WiFi.RSSI(i));
                WiFi.scanDelete();
                return;
            }
        }
        Serial.printf("  not found among %d networks. Is the hotspot on and set to 2.4 GHz?\n", count);
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
            Serial.printf("Wi-Fi not connected: %s (%d). Retrying automatically.\n",
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
        Serial.printf("Wi-Fi connected, signal %d dBm\n", WiFi.RSSI());
        Serial.printf("Camera page:   http://%s/\n", ip.c_str());
        Serial.printf("Snapshot:      http://%s/capture\n", ip.c_str());
        Serial.printf("Status (JSON): http://%s/status\n", ip.c_str());
        Serial.printf("MJPEG stream:  http://%s:81/stream\n", ip.c_str());
    }
}

void setup()
{
    Serial.begin(115200);
    delay(1500);
    Serial.println("\nNestTrace ESP32-S3 camera starting");

    // Camera first: the raw-mode frame buffer needs a large block of internal RAM before Wi-Fi takes its share.
    cameraReady = cameraBegin();
    if (!cameraReady)
    {
        Serial.println("Stopped: camera not usable.");
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
                Serial.println("Web server failed to start; press reset.");
            }
        }
        if (serversStarted)
        {
            announce();
        }
    }
    delay(100);
}
