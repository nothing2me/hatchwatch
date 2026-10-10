// Motion on the ESP32: an 80x60 grey grid compared with a slowly adapting background.
// A viewing aid only. It is not the digging detector and raises no alerts.
#pragma once

#include <Arduino.h>
#include "esp_camera.h"

namespace motion
{
    constexpr uint8_t DEFAULT_THRESHOLD = 20;  // brightness change (0-255) that counts as motion

    struct Snapshot
    {
        float percent = 0;       // share of the picture moving, 0-100
        bool active = false;     // percent at or above the minimum area, with a short hold
        uint16_t x = 0, y = 0;   // box around moving cells, in picture pixels
        uint16_t w = 0, h = 0;
        uint32_t lastMotionMs = 0;
        uint8_t threshold = DEFAULT_THRESHOLD;
    };

    bool begin();                           // allocates the grids (PSRAM); call once
    void feed(const camera_fb_t *frame);    // RGB565 frames only; others are ignored
    Snapshot snapshot();
    void setThreshold(uint8_t value);
    void resetBackground();
    // The current motion mask as a small grey JPEG; free(*jpeg) after use.
    bool maskJpeg(uint8_t **jpeg, size_t *length);
}
