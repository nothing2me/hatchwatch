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

// One JPEG frame. Releases the camera buffer (and the encoded copy) when it goes out of scope.
class JpegFrame
{
public:
    JpegFrame();
    ~JpegFrame();
    JpegFrame(const JpegFrame &) = delete;
    JpegFrame &operator=(const JpegFrame &) = delete;

    bool ok() const { return data_ != nullptr; }
    const uint8_t *data() const { return data_; }
    size_t length() const { return length_; }

private:
    camera_fb_t *frame_ = nullptr;
    uint8_t *data_ = nullptr;
    size_t length_ = 0;
    bool ownsData_ = false;
};
