// Camera wiring of the Freenove ESP32-S3 WROOM board (ESP32-S3-WROOM-1 N8R8 / N16R8).
#pragma once

namespace pins
{
    constexpr int PWDN = -1;
    constexpr int RESET = -1;
    constexpr int XCLK = 15;
    constexpr int SIOD = 4;  // SCCB data (I2C-like control bus)
    constexpr int SIOC = 5;  // SCCB clock

    constexpr int D0 = 11;
    constexpr int D1 = 9;
    constexpr int D2 = 8;
    constexpr int D3 = 10;
    constexpr int D4 = 12;
    constexpr int D5 = 18;
    constexpr int D6 = 17;
    constexpr int D7 = 16;

    constexpr int VSYNC = 6;
    constexpr int HREF = 7;
    constexpr int PCLK = 13;

    constexpr int ALL[] = { XCLK, SIOD, SIOC, D0, D1, D2, D3, D4, D5, D6, D7, VSYNC, HREF, PCLK };

    // WROOM-1 datasheet: on Octal-PSRAM modules IO35..IO37 belong to the PSRAM,
    // and IO0, IO3, IO45, IO46 are strapping pins. The camera must use none of them.
    constexpr bool isReserved(int pin)
    {
        return pin == 0 || pin == 3 || pin == 45 || pin == 46 || (pin >= 35 && pin <= 37);
    }

    constexpr bool noneReserved(int index = 0)
    {
        return index == static_cast<int>(sizeof(ALL) / sizeof(ALL[0]))
            || (!isReserved(ALL[index]) && noneReserved(index + 1));
    }

    static_assert(noneReserved(), "Camera pin collides with Octal PSRAM or a strapping pin");
}
