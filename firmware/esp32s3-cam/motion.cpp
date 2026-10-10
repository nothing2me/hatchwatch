#include "motion.h"

#include "console.h"
#include "freertos/semphr.h"
#include "img_converters.h"

namespace motion
{
    namespace
    {
        constexpr int GRID_W = 80;
        constexpr int GRID_H = 60;
        constexpr int CELLS = GRID_W * GRID_H;
        constexpr int BG_SHIFT = 4;               // background kept as value << 4 for smooth averaging
        constexpr int BG_RATE_SHIFT = 3;          // background moves 1/8 of the gap per frame (still objects fade in ~2 s at 5 fps)
        constexpr float MIN_AREA_PERCENT = 1.0f;  // below this the picture counts as still (sensor noise)
        constexpr uint32_t HOLD_MS = 2000;        // stays "active" this long after the last motion

        uint16_t *background = nullptr;  // CELLS, value << BG_SHIFT
        uint8_t *mask = nullptr;         // CELLS, 255 = moving
        bool primed = false;
        uint8_t threshold = DEFAULT_THRESHOLD;
        Snapshot latest;
        SemaphoreHandle_t lock = nullptr;

        // esp32-camera stores RGB565 high byte first.
        inline uint8_t luma(const uint8_t *pixel)
        {
            const uint16_t value = (pixel[0] << 8) | pixel[1];
            const uint32_t r = (value >> 11) << 3;
            const uint32_t g = ((value >> 5) & 0x3F) << 2;
            const uint32_t b = (value & 0x1F) << 3;
            return static_cast<uint8_t>((r * 77 + g * 150 + b * 29) >> 8);
        }
    }

    bool begin()
    {
        lock = xSemaphoreCreateMutex();
        background = static_cast<uint16_t *>(ps_malloc(CELLS * sizeof(uint16_t)));
        mask = static_cast<uint8_t *>(ps_malloc(CELLS));
        if (!lock || !background || !mask)
        {
            CONSOLE("Motion: not enough memory, motion disabled\n");
            return false;
        }
        memset(mask, 0, CELLS);
        return true;
    }

    void feed(const camera_fb_t *frame)
    {
        if (!mask || !frame || frame->format != PIXFORMAT_RGB565 || frame->width < GRID_W || frame->height < GRID_H)
        {
            return;
        }
        const int stepX = frame->width / GRID_W;
        const int stepY = frame->height / GRID_H;
        int moving = 0;
        int minX = GRID_W, minY = GRID_H, maxX = -1, maxY = -1;

        xSemaphoreTake(lock, portMAX_DELAY);
        for (int gy = 0; gy < GRID_H; gy++)
        {
            const uint8_t *row = frame->buf + static_cast<size_t>(gy * stepY) * frame->width * 2;
            for (int gx = 0; gx < GRID_W; gx++)
            {
                const int cell = gy * GRID_W + gx;
                const int y = luma(row + gx * stepX * 2);
                if (!primed)
                {
                    background[cell] = y << BG_SHIFT;
                    continue;
                }
                const int bg = background[cell];
                const int diff = abs(y - (bg >> BG_SHIFT));
                const bool isMoving = diff > threshold;
                mask[cell] = isMoving ? 255 : 0;
                background[cell] = bg + (((y << BG_SHIFT) - bg) >> BG_RATE_SHIFT);
                if (isMoving)
                {
                    moving++;
                    minX = min(minX, gx);
                    maxX = max(maxX, gx);
                    minY = min(minY, gy);
                    maxY = max(maxY, gy);
                }
            }
        }
        const bool wasPrimed = primed;
        primed = true;

        const uint32_t now = millis();
        const bool wasActive = latest.active;
        latest.percent = wasPrimed ? 100.0f * moving / CELLS : 0;
        latest.threshold = threshold;
        if (latest.percent >= MIN_AREA_PERCENT)
        {
            latest.lastMotionMs = now;
            latest.x = minX * stepX;
            latest.y = minY * stepY;
            latest.w = (maxX - minX + 1) * stepX;
            latest.h = (maxY - minY + 1) * stepY;
        }
        latest.active = latest.lastMotionMs != 0 && now - latest.lastMotionMs < HOLD_MS;
        const Snapshot state = latest;
        xSemaphoreGive(lock);

        if (state.active && !wasActive)
        {
            CONSOLE("Motion %.1f%% at %u,%u %ux%u\n", state.percent, state.x, state.y, state.w, state.h);
        }
        else if (!state.active && wasActive)
        {
            CONSOLE("Motion stopped\n");
        }
    }

    Snapshot snapshot()
    {
        if (!lock)
        {
            return Snapshot();
        }
        xSemaphoreTake(lock, portMAX_DELAY);
        Snapshot state = latest;
        xSemaphoreGive(lock);
        state.active = state.lastMotionMs != 0 && millis() - state.lastMotionMs < HOLD_MS;
        return state;
    }

    void setThreshold(uint8_t value)
    {
        if (!lock)
        {
            return;
        }
        xSemaphoreTake(lock, portMAX_DELAY);
        threshold = constrain(value, 5, 100);
        xSemaphoreGive(lock);
    }

    void resetBackground()
    {
        if (!lock)
        {
            return;
        }
        xSemaphoreTake(lock, portMAX_DELAY);
        primed = false;
        memset(mask, 0, CELLS);
        xSemaphoreGive(lock);
    }

    bool maskJpeg(uint8_t **jpeg, size_t *length)
    {
        if (!mask)
        {
            return false;
        }
        uint8_t *copy = static_cast<uint8_t *>(malloc(CELLS));  // off the small HTTP task stack
        if (!copy)
        {
            return false;
        }
        xSemaphoreTake(lock, portMAX_DELAY);
        memcpy(copy, mask, CELLS);
        xSemaphoreGive(lock);
        const bool ok = fmt2jpg(copy, CELLS, GRID_W, GRID_H, PIXFORMAT_GRAYSCALE, 80, jpeg, length);
        free(copy);
        return ok;
    }
}
