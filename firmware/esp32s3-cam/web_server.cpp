#include "web_server.h"

#include <WiFi.h>
#include "camera.h"
#include "console.h"
#include "esp_http_server.h"
#include "motion.h"
#include "uplink.h"
#include "web_page.h"

namespace
{
    constexpr char STREAM_BOUNDARY[] = "frame";
    constexpr uint32_t STREAM_WAIT_MS = 2000;  // longest wait for the capture task's next frame
    constexpr int STREAM_RETRIES = 3;          // missed frames tolerated before a stream gives up

    httpd_handle_t pageServer = nullptr;
    httpd_handle_t streamServer = nullptr;

    // Frames per second of the most recent stream, smoothed; 0 once no stream is running.
    volatile float streamFps = 0;
    volatile uint32_t lastStreamFrameMs = 0;

    esp_err_t sendPage(httpd_req_t *req)
    {
        httpd_resp_set_type(req, "text/html; charset=utf-8");
        httpd_resp_set_hdr(req, "Cache-Control", "no-store");
        return httpd_resp_send(req, WEB_PAGE, HTTPD_RESP_USE_STRLEN);
    }

    esp_err_t sendCapture(httpd_req_t *req)
    {
        JpegFrame frame;
        if (!frame.ok())
        {
            return httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Camera capture failed");
        }
        char query[32] = {};
        const bool download = httpd_req_get_url_query_str(req, query, sizeof(query)) == ESP_OK
            && strstr(query, "download=1") != nullptr;

        httpd_resp_set_type(req, "image/jpeg");
        httpd_resp_set_hdr(req, "Cache-Control", "no-store");
        httpd_resp_set_hdr(req, "Content-Disposition",
                           download ? "attachment; filename=snapshot.jpg" : "inline; filename=snapshot.jpg");
        return httpd_resp_send(req, reinterpret_cast<const char *>(frame.data()), frame.length());
    }

    esp_err_t sendStatus(httpd_req_t *req)
    {
        const CameraInfo &camera = cameraInfo();
        const bool streaming = millis() - lastStreamFrameMs < 2000;
        const motion::Snapshot moving = motion::snapshot();
        const long sinceMotion = moving.lastMotionMs ? static_cast<long>((millis() - moving.lastMotionMs) / 1000) : -1;
        const uplink::Status up = uplink::status();
        char body[768];
        snprintf(body, sizeof(body),
                 "{\"sensor\":\"%s\",\"pid\":%u,\"mode\":\"%s\",\"width\":%u,\"height\":%u,"
                 "\"psramBuffer\":%s,\"fps\":%.1f,\"rssi\":%d,\"uptime\":%lu,\"freeHeap\":%u,"
                 "\"motion\":{\"percent\":%.1f,\"active\":%s,\"box\":[%u,%u,%u,%u],"
                 "\"secondsSince\":%ld,\"threshold\":%u},"
                 "\"uplink\":{\"state\":\"%s\",\"sent\":%lu,\"lastError\":\"%s\"}}",
                 camera.sensorName, camera.sensorPid, captureModeName(camera.mode), camera.width, camera.height,
                 camera.frameBufferInPsram ? "true" : "false", streaming ? streamFps : 0.0f, WiFi.RSSI(),
                 static_cast<unsigned long>(millis() / 1000), static_cast<unsigned>(ESP.getFreeHeap()),
                 moving.percent, moving.active ? "true" : "false", moving.x, moving.y, moving.w, moving.h,
                 sinceMotion, moving.threshold,
                 up.state, static_cast<unsigned long>(up.sent), up.lastError);
        httpd_resp_set_type(req, "application/json");
        httpd_resp_set_hdr(req, "Cache-Control", "no-store");
        return httpd_resp_send(req, body, HTTPD_RESP_USE_STRLEN);
    }

    esp_err_t sendMotionMask(httpd_req_t *req)
    {
        uint8_t *jpeg = nullptr;
        size_t length = 0;
        if (!motion::maskJpeg(&jpeg, &length))
        {
            return httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Motion not available");
        }
        httpd_resp_set_type(req, "image/jpeg");
        httpd_resp_set_hdr(req, "Cache-Control", "no-store");
        const esp_err_t result = httpd_resp_send(req, reinterpret_cast<const char *>(jpeg), length);
        free(jpeg);
        return result;
    }

    // POST /motion/settings?threshold=NN or ?reset=1
    esp_err_t updateMotion(httpd_req_t *req)
    {
        char query[48] = {};
        char value[8] = {};
        if (httpd_req_get_url_query_str(req, query, sizeof(query)) == ESP_OK)
        {
            if (httpd_query_key_value(query, "threshold", value, sizeof(value)) == ESP_OK)
            {
                motion::setThreshold(static_cast<uint8_t>(atoi(value)));
            }
            if (httpd_query_key_value(query, "reset", value, sizeof(value)) == ESP_OK)
            {
                motion::resetBackground();
            }
        }
        httpd_resp_set_hdr(req, "Cache-Control", "no-store");
        return httpd_resp_send(req, nullptr, 0);
    }

    esp_err_t sendStreamPart(httpd_req_t *req, const JpegFrame &frame)
    {
        char header[96];
        const int headerLength = snprintf(header, sizeof(header),
                                          "--%s\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n",
                                          STREAM_BOUNDARY, static_cast<unsigned>(frame.length()));
        esp_err_t result = httpd_resp_send_chunk(req, header, headerLength);
        if (result == ESP_OK)
        {
            result = httpd_resp_send_chunk(req, reinterpret_cast<const char *>(frame.data()), frame.length());
        }
        if (result == ESP_OK)
        {
            result = httpd_resp_send_chunk(req, "\r\n", 2);
        }
        return result;
    }

    esp_err_t sendStream(httpd_req_t *req)
    {
        httpd_resp_set_type(req, "multipart/x-mixed-replace;boundary=frame");
        httpd_resp_set_hdr(req, "Cache-Control", "no-store");
        httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

        int misses = 0;
        uint32_t previous = millis();
        uint32_t sequence = 0;
        while (true)
        {
            esp_err_t result = ESP_OK;
            {
                JpegFrame frame(sequence, STREAM_WAIT_MS);  // waits for a frame newer than the last one sent
                if (!frame.ok())
                {
                    if (++misses > STREAM_RETRIES)
                    {
                        CONSOLE("Stream: camera stopped delivering frames\n");
                        return ESP_FAIL;
                    }
                    continue;
                }
                misses = 0;
                sequence = frame.sequence();
                result = sendStreamPart(req, frame);
            }
            if (result != ESP_OK)
            {
                return ESP_OK;  // viewer closed the page
            }

            const uint32_t now = millis();
            const float instant = now > previous ? 1000.0f / (now - previous) : 0;
            streamFps = streamFps <= 0 ? instant : streamFps * 0.9f + instant * 0.1f;
            lastStreamFrameMs = now;
            previous = now;
        }
    }

    bool registerRoute(httpd_handle_t server, const char *uri, esp_err_t (*handler)(httpd_req_t *),
                       httpd_method_t method = HTTP_GET)
    {
        httpd_uri_t route = {};
        route.uri = uri;
        route.method = method;
        route.handler = handler;
        return httpd_register_uri_handler(server, &route) == ESP_OK;
    }
}

bool webServerBegin()
{
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.server_port = 80;
    config.stack_size = 8192;
    if (httpd_start(&pageServer, &config) != ESP_OK
        || !registerRoute(pageServer, "/", sendPage)
        || !registerRoute(pageServer, "/capture", sendCapture)
        || !registerRoute(pageServer, "/status", sendStatus)
        || !registerRoute(pageServer, "/motion", sendMotionMask)
        || !registerRoute(pageServer, "/motion/settings", updateMotion, HTTP_POST))
    {
        CONSOLE("Page server failed to start\n");
        return false;
    }

    // The stream runs forever per viewer, so it gets its own server and does not block the page.
    config.server_port = 81;
    config.ctrl_port += 1;
    if (httpd_start(&streamServer, &config) != ESP_OK || !registerRoute(streamServer, "/stream", sendStream))
    {
        CONSOLE("Stream server failed to start\n");
        return false;
    }
    return true;
}
