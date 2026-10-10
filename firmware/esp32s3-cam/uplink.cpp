#include "uplink.h"

#include <HTTPClient.h>
#include <NetworkClientSecure.h>
#include <WiFi.h>
#include "camera.h"
#include "console.h"
#include "esp_heap_caps.h"
#include "freertos/idf_additions.h"
#include "freertos/semphr.h"
#include "mbedtls/platform.h"
#include "motion.h"
#include "secrets.h"

namespace
{
    constexpr uint32_t MIN_INTERVAL_MS = 200;        // at most 5 frames per second
    constexpr uint32_t BACKOFF_FIRST_MS = 2000;
    constexpr uint32_t BACKOFF_MAX_MS = 30000;
    constexpr uint32_t BUSY_WAIT_MS = 1000;          // after 429
    constexpr size_t MIN_INTERNAL_FREE = 12 * 1024;  // sockets and lwIP still use internal RAM
    constexpr uint32_t STACK_BYTES = 12 * 1024;      // in PSRAM; this task must not write flash or NVS (its stack is in PSRAM)

    SemaphoreHandle_t statusLock = nullptr;
    uplink::Status current;

    // mbedTLS buffers (2 x 16 KB records plus handshake state) go to PSRAM; internal RAM only as a fallback.
    void *tlsCalloc(size_t count, size_t size)
    {
        void *block = heap_caps_calloc(count, size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
        return block ? block : heap_caps_calloc(count, size, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    }

    void tlsFree(void *block)
    {
        heap_caps_free(block);  // frees from either heap, so blocks made before the switch are fine
    }

    void setState(const char *state, const char *error = nullptr)
    {
        xSemaphoreTake(statusLock, portMAX_DELAY);
        current.state = state;
        if (error)
        {
            // The text goes into /status JSON: keep it printable and free of quotes and backslashes.
            size_t i = 0;
            for (; error[i] && i < sizeof(current.lastError) - 1; i++)
            {
                const char c = error[i];
                current.lastError[i] = (c == '"' || c == '\\' || c < 0x20) ? ' ' : c;
            }
            current.lastError[i] = '\0';
        }
        xSemaphoreGive(statusLock);
    }

    void countSent()
    {
        xSemaphoreTake(statusLock, portMAX_DELAY);
        current.state = "sending";
        current.sent++;
        current.lastError[0] = '\0';  // the last error is cleared once a frame gets through
        xSemaphoreGive(statusLock);
    }

    bool hasCertificate()
    {
        const char *volatile ca = DASHBOARD_CA;  // read at run time: GCC folds strstr on the constant and warns
        return strstr(ca, "-----BEGIN CERTIFICATE-----") != nullptr;
    }

    void backOff(uint32_t &backoff)
    {
        delay(backoff);
        backoff = min(backoff * 2, BACKOFF_MAX_MS);
    }

    void uplinkTask(void *)
    {
        NetworkClientSecure tls;
        tls.setCACert(DASHBOARD_CA);  // verified against Caddy's root; there is no insecure mode
        tls.setHandshakeTimeout(15);
        HTTPClient http;
        http.setReuse(true);  // one keep-alive TLS connection for every frame
        http.setConnectTimeout(5000);
        http.setTimeout(5000);
        String base(DASHBOARD_URL);
        while (base.endsWith("/"))
        {
            base.remove(base.length() - 1);  // "https://host:3443/" and "https://host:3443" give the same URL
        }
        const String url = base + "/api/live/frame/" + DEVICE_ID;
        const String authorization = String("Bearer ") + DEVICE_TOKEN;

        uint32_t sequence = 0;
        uint32_t lastSend = 0;
        uint32_t backoff = BACKOFF_FIRST_MS;
        while (true)
        {
            if (WiFi.status() != WL_CONNECTED)
            {
                setState("waiting-for-wifi");
                tls.stop();
                delay(1000);
                continue;
            }
            JpegFrame frame(sequence, 1000);  // the next frame newer than the last one sent
            if (!frame.ok())
            {
                delay(100);  // an encoder failure returns at once; yield so the idle task can feed the watchdog
                continue;
            }
            sequence = frame.sequence();
            const uint32_t since = millis() - lastSend;
            if (since < MIN_INTERVAL_MS)
            {
                delay(MIN_INTERVAL_MS - since);
            }

            if (!tls.connected())
            {
                const size_t internal = heap_caps_get_free_size(MALLOC_CAP_INTERNAL);
                if (internal < MIN_INTERNAL_FREE)
                {
                    char error[64];
                    snprintf(error, sizeof(error), "only %u B internal RAM free", static_cast<unsigned>(internal));
                    CONSOLE("Dashboard upload: %s; retrying in %u s.\n", error, static_cast<unsigned>(backoff / 1000));
                    setState("no-memory", error);
                    backOff(backoff);
                    continue;
                }
                setState("connecting");
            }

            const motion::Snapshot moving = motion::snapshot();
            char motionValue[96];
            uplink::motionHeader(motionValue, sizeof(motionValue), moving.percent, moving.active, moving.x, moving.y, moving.w, moving.h);

            lastSend = millis();
            http.begin(tls, url);
            http.addHeader("Authorization", authorization);
            http.addHeader("Content-Type", "image/jpeg");
            http.addHeader("X-HatchWatch-Motion", motionValue);
            const int code = http.POST(const_cast<uint8_t *>(frame.data()), frame.length());
            if (code > 0)
            {
                http.getString();  // read the small JSON reply so the connection can be reused
            }
            http.end();

            if (code == 200)
            {
                countSent();
                backoff = BACKOFF_FIRST_MS;
                continue;
            }
            if (code == 401 || code == 403)
            {
                CONSOLE("Dashboard refused the token (HTTP %d). Check DEVICE_ID and DEVICE_TOKEN in secrets.h; upload stopped.\n", code);
                setState("refused", "Dashboard refused the token");
                tls.stop();
                while (true)
                {
                    delay(60 * 1000);  // stays stopped until reset; a task made WithCaps cannot delete itself
                }
            }
            if (code == 429)
            {
                setState("sending", "HTTP 429: more than 10 frames a second");
                delay(BUSY_WAIT_MS);
                continue;
            }

            char error[96];
            if (code < 0)
            {
                char tlsError[64] = "";
                tls.lastError(tlsError, sizeof(tlsError));
                snprintf(error, sizeof(error), "%s%s%s", HTTPClient::errorToString(code).c_str(), tlsError[0] ? ": " : "", tlsError);
            }
            else
            {
                snprintf(error, sizeof(error), "HTTP %d", code);
            }
            CONSOLE("Dashboard upload failed: %s. Retrying in %u s.\n", error, static_cast<unsigned>(backoff / 1000));
            setState("retrying", error);
            tls.stop();
            backOff(backoff);
        }
    }
}

void uplink::useTlsMemoryInPsram()
{
    mbedtls_platform_set_calloc_free(tlsCalloc, tlsFree);
}

bool uplink::begin()
{
    if (!statusLock)
    {
        statusLock = xSemaphoreCreateMutex();
        if (!statusLock)
        {
            return false;
        }
    }
    if (strlen(DASHBOARD_URL) == 0)
    {
        CONSOLE("Dashboard upload off (DASHBOARD_URL is empty in secrets.h).\n");
        setState("off");
        return true;
    }
    if (strncmp(DASHBOARD_URL, "https://", 8) != 0)
    {
        CONSOLE("Dashboard upload off: DASHBOARD_URL must start with https://\n");
        setState("off", "DASHBOARD_URL must start with https://");
        return false;
    }
    if (!hasCertificate())
    {
        CONSOLE("Dashboard upload off: paste Caddy's root certificate into DASHBOARD_CA (README).\n");
        setState("no-certificate", "DASHBOARD_CA has no certificate");
        return false;
    }
    if (xTaskCreatePinnedToCoreWithCaps(uplinkTask, "uplink", STACK_BYTES, nullptr, 1, nullptr, 0, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT) != pdPASS)
    {
        CONSOLE("Dashboard upload off: could not start its task.\n");
        setState("no-memory", "could not start the uplink task");
        return false;
    }
    CONSOLE("Dashboard upload: %s as device %s\n", DASHBOARD_URL, DEVICE_ID);  // never the token
    return true;
}

uplink::Status uplink::status()
{
    if (!statusLock)
    {
        return Status{};
    }
    xSemaphoreTake(statusLock, portMAX_DELAY);
    const Status copy = current;
    xSemaphoreGive(statusLock);
    return copy;
}

int uplink::motionHeader(char *out, size_t size, float percent, bool active, uint16_t x, uint16_t y, uint16_t w, uint16_t h)
{
    const float clamped = percent >= 0 ? (percent <= 100 ? percent : 100) : 0;  // NaN fails both tests and becomes 0
    if (!active)
    {
        x = y = w = h = 0;  // the contract sends 0,0,0,0 when nothing moves
    }
    return snprintf(out, size, "v1;percent=%.1f;active=%d;box=%u,%u,%u,%u", clamped, active ? 1 : 0, x, y, w, h);
}
