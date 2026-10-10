#include "camera.h"

#include "board_pins.h"
#include "esp_heap_caps.h"
#include "img_converters.h"

namespace
{
    CameraInfo info;

    // Quality of the ESP32's own JPEG encoder in raw mode (0-100, higher is better).
    constexpr uint8_t SOFTWARE_JPEG_QUALITY = 80;

    // Raw sizes to try, largest first. A raw frame is width x height x 2 bytes and must fit
    // in internal RAM (see makeConfig), so nothing above QVGA (150 KB).
    constexpr framesize_t RAW_SIZES[] = { FRAMESIZE_QVGA, FRAMESIZE_HQVGA, FRAMESIZE_QQVGA };

    camera_config_t makeConfig(pixformat_t format, framesize_t size)
    {
        camera_config_t config = {};
        config.ledc_channel = LEDC_CHANNEL_0;
        config.ledc_timer = LEDC_TIMER_0;
        config.pin_d0 = pins::D0;
        config.pin_d1 = pins::D1;
        config.pin_d2 = pins::D2;
        config.pin_d3 = pins::D3;
        config.pin_d4 = pins::D4;
        config.pin_d5 = pins::D5;
        config.pin_d6 = pins::D6;
        config.pin_d7 = pins::D7;
        config.pin_xclk = pins::XCLK;
        config.pin_pclk = pins::PCLK;
        config.pin_vsync = pins::VSYNC;
        config.pin_href = pins::HREF;
        config.pin_sccb_sda = pins::SIOD;
        config.pin_sccb_scl = pins::SIOC;
        config.pin_pwdn = pins::PWDN;
        config.pin_reset = pins::RESET;
        config.pixel_format = format;
        config.frame_size = size;
        config.jpeg_quality = 12;

        if (format == PIXFORMAT_JPEG)
        {
            // JPEG frames are small, so double-buffering in PSRAM keeps up easily.
            config.xclk_freq_hz = 20000000;
            config.fb_location = CAMERA_FB_IN_PSRAM;
            config.fb_count = 2;
            config.grab_mode = CAMERA_GRAB_LATEST;
        }
        else
        {
            // The cause of the striped picture: raw frames stream ~2 bytes per pixel through GDMA.
            // In PSRAM that DMA competes with Wi-Fi and the JPEG encoder for the shared SPI bus,
            // the camera FIFO overflows and whole lines are dropped or shifted. Internal SRAM has
            // no such contention. A slower XCLK also lowers the pixel clock the DMA has to match.
            config.xclk_freq_hz = 10000000;
            config.fb_location = CAMERA_FB_IN_DRAM;
            config.fb_count = 1;
            config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
        }
        return config;
    }

    void readSensorIdentity()
    {
        sensor_t *sensor = esp_camera_sensor_get();
        if (!sensor)
        {
            return;
        }
        info.sensorPid = sensor->id.PID;
        camera_sensor_info_t *details = esp_camera_sensor_get_info(&sensor->id);
        if (details)
        {
            info.sensorName = details->name;
        }
    }

    void applyOrientation()
    {
        sensor_t *sensor = esp_camera_sensor_get();
        if (sensor && sensor->id.PID == OV2640_PID)
        {
            sensor->set_hmirror(sensor, 1);
            sensor->set_vflip(sensor, 1);
        }
    }

    bool startHardwareJpeg()
    {
        // Init at SVGA so the JPEG buffer is roomy, then drop to VGA for a smooth stream.
        camera_config_t config = makeConfig(PIXFORMAT_JPEG, FRAMESIZE_SVGA);
        if (esp_camera_init(&config) != ESP_OK)
        {
            return false;
        }
        sensor_t *sensor = esp_camera_sensor_get();
        if (!sensor)
        {
            esp_camera_deinit();
            return false;
        }
        sensor->set_framesize(sensor, FRAMESIZE_VGA);
        applyOrientation();
        info.mode = CaptureMode::HardwareJpeg;
        info.width = resolution[FRAMESIZE_VGA].width;
        info.height = resolution[FRAMESIZE_VGA].height;
        info.frameBufferInPsram = true;
        return true;
    }

    bool rawFramesArrive(size_t expectedBytes)
    {
        int good = 0;
        for (int attempt = 0; attempt < 4 && good < 2; attempt++)
        {
            camera_fb_t *frame = esp_camera_fb_get();
            if (frame)
            {
                good += frame->len == expectedBytes ? 1 : 0;
                esp_camera_fb_return(frame);
            }
        }
        return good >= 2;
    }

    bool startRawRgb565()
    {
        for (framesize_t size : RAW_SIZES)
        {
            const uint16_t width = resolution[size].width;
            const uint16_t height = resolution[size].height;
            const size_t bytes = static_cast<size_t>(width) * height * 2;
            const size_t largest = heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_DMA);
            Serial.printf("  raw %ux%u needs %u B, largest internal DMA block %u B ... ", width, height,
                          static_cast<unsigned>(bytes), static_cast<unsigned>(largest));
            if (largest < bytes + 16 * 1024)
            {
                Serial.println("skipped");
                continue;
            }

            camera_config_t config = makeConfig(PIXFORMAT_RGB565, size);
            if (esp_camera_init(&config) != ESP_OK)
            {
                Serial.println("init failed");
                continue;
            }
            if (rawFramesArrive(bytes))
            {
                Serial.println("ok");
                applyOrientation();
                info.mode = CaptureMode::RawRgb565;
                info.width = width;
                info.height = height;
                info.frameBufferInPsram = false;
                return true;
            }
            Serial.println("no complete frames");
            esp_camera_deinit();
            delay(100);
        }
        return false;
    }
}

bool cameraBegin()
{
    if (!psramFound())
    {
        Serial.println("PSRAM not found: set Tools > PSRAM to \"OPI PSRAM\" and upload again.");
        return false;
    }

    if (startHardwareJpeg())
    {
        readSensorIdentity();
    }
    else
    {
        Serial.println("Sensor has no hardware JPEG; trying raw RGB565 in internal RAM:");
        if (!startRawRgb565())
        {
            Serial.println("No raw size worked. Reseat the camera ribbon and remove anything wired to GPIO 4-18.");
            return false;
        }
        readSensorIdentity();
    }

    Serial.printf("Camera: %s (PID 0x%04x), %s, %ux%u, frame buffer in %s\n", info.sensorName, info.sensorPid,
                  captureModeName(info.mode), info.width, info.height, info.frameBufferInPsram ? "PSRAM" : "internal RAM");
    return true;
}

const CameraInfo &cameraInfo()
{
    return info;
}

const char *captureModeName(CaptureMode mode)
{
    switch (mode)
    {
    case CaptureMode::HardwareJpeg:
        return "hardware JPEG";
    case CaptureMode::RawRgb565:
        return "RGB565 + software JPEG";
    default:
        return "none";
    }
}

JpegFrame::JpegFrame()
{
    frame_ = esp_camera_fb_get();
    if (!frame_)
    {
        return;
    }
    if (frame_->format == PIXFORMAT_JPEG)
    {
        data_ = frame_->buf;
        length_ = frame_->len;
        return;
    }
    uint8_t *encoded = nullptr;
    size_t encodedLength = 0;
    if (frame2jpg(frame_, SOFTWARE_JPEG_QUALITY, &encoded, &encodedLength))
    {
        data_ = encoded;
        length_ = encodedLength;
        ownsData_ = true;
    }
    // The raw buffer is free again as soon as it is encoded, so the camera can fill the next frame.
    esp_camera_fb_return(frame_);
    frame_ = nullptr;
}

JpegFrame::~JpegFrame()
{
    if (ownsData_)
    {
        free(data_);
    }
    if (frame_)
    {
        esp_camera_fb_return(frame_);
    }
}
