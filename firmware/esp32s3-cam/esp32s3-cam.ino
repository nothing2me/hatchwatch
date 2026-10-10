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
    constexpr uint32_t WIFI_TIMEOUT_MS = 30000;

    bool connectWifi()
    {
        WiFi.mode(WIFI_STA);
        WiFi.setSleep(false);  // power save adds latency spikes to the stream
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

        Serial.print("Connecting to Wi-Fi");
        const uint32_t started = millis();
        while (WiFi.status() != WL_CONNECTED)
        {
            if (millis() - started > WIFI_TIMEOUT_MS)
            {
                Serial.println("\nWi-Fi timed out. Check secrets.h, then press reset.");
                return false;
            }
            delay(500);
            Serial.print('.');
        }
        Serial.printf("\nWi-Fi connected, signal %d dBm\n", WiFi.RSSI());
        return true;
    }
}

void setup()
{
    Serial.begin(115200);
    delay(1500);
    Serial.println("\nNestTrace ESP32-S3 camera starting");

    // Camera first: the raw-mode frame buffer needs a large block of internal RAM before Wi-Fi takes its share.
    if (!cameraBegin())
    {
        Serial.println("Stopped: camera not usable.");
        return;
    }
    if (!connectWifi() || !webServerBegin())
    {
        Serial.println("Stopped: network not ready.");
        return;
    }

    const String ip = WiFi.localIP().toString();
    Serial.printf("Camera page:   http://%s/\n", ip.c_str());
    Serial.printf("Snapshot:      http://%s/capture\n", ip.c_str());
    Serial.printf("Status (JSON): http://%s/status\n", ip.c_str());
    Serial.printf("MJPEG stream:  http://%s:81/stream\n", ip.c_str());
}

void loop()
{
    // Reconnect quietly if the access point drops; the HTTP servers keep running.
    static uint32_t lastCheck = 0;
    if (millis() - lastCheck > 10000)
    {
        lastCheck = millis();
        if (WiFi.status() != WL_CONNECTED)
        {
            Serial.println("Wi-Fi lost, reconnecting");
            WiFi.reconnect();
        }
    }
    delay(100);
}
