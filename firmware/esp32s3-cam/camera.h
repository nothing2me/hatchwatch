// Camera start-up and JPEG frame access.
#pragma once

#include <Arduino.h>
#include "esp_camera.h"

enum class CaptureMode
{
    None,
    HardwareJpeg,  // sensor encodes JPEG itself (OV2640, OV3660, OV5640)
    RawRgb565,     // sensor has no JPEG (e.g. GC2145): raw frames, encoded on the ESP32
};

struct CameraInfo
{
    CaptureMode mode = CaptureMode::None;
    const char *sensorName = "unknown";
    uint16_t sensorPid = 0;
    uint16_t width = 0;
    uint16_t height = 0;
    bool frameBufferInPsram = false;
};

// Starts the camera. Call before Wi-Fi so the internal-RAM frame buffer can still be allocated.
bool cameraBegin();
const CameraInfo &cameraInfo();
const char *captureModeName(CaptureMode mode);

// Starts the task that owns the camera: it captures continuously, runs motion on raw frames and keeps
// the newest JPEG for any number of viewers. Call once after cameraBegin().
bool cameraStartCapture();

// A copy of the newest JPEG. With afterSequence, waits (up to waitMs) for a frame newer than that.
class JpegFrame
{
public:
    explicit JpegFrame(uint32_t afterSequence = 0, uint32_t waitMs = 1000);
    ~JpegFrame();
    JpegFrame(const JpegFrame &) = delete;
    JpegFrame &operator=(const JpegFrame &) = delete;

    bool ok() const { return data_ != nullptr; }
    const uint8_t *data() const { return data_; }
    size_t length() const { return length_; }
    uint32_t sequence() const { return sequence_; }

private:
    uint8_t *data_ = nullptr;
    size_t length_ = 0;
    uint32_t sequence_ = 0;
};
