// Sends the newest JPEG and the board's motion to the HatchWatch dashboard over HTTPS (schemas/esp32-frame.v1.md).
// Motion is a viewing aid only; nothing here reaches the digging detector.
#pragma once

#include <Arduino.h>

namespace uplink
{
    struct Status
    {
        const char *state = "off";  // off | no-certificate | waiting-for-wifi | connecting | sending | retrying | no-memory | refused
        uint32_t sent = 0;
        char lastError[96] = "";
    };

    // Moves mbedTLS allocations to PSRAM. Call first in setup(), before Wi-Fi or any TLS.
    void useTlsMemoryInPsram();
    // Starts the uplink task when DASHBOARD_URL is set. Call once, after the first IP address.
    bool begin();
    Status status();
    // Writes the X-HatchWatch-Motion value ("v1;percent=4.2;active=1;box=96,40,64,72"); returns snprintf's result.
    int motionHeader(char *out, size_t size, float percent, bool active, uint16_t x, uint16_t y, uint16_t w, uint16_t h);
}
