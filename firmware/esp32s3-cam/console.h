// Log lines for the Serial Monitor.
// Uses the chip console (the same path as the camera driver's messages), which reaches the
// native USB port whatever "USB CDC On Boot" is set to; Arduino's Serial may not.
#pragma once

#include <stdio.h>

#define CONSOLE(...)              \
    do                            \
    {                             \
        printf(__VA_ARGS__);      \
        fflush(stdout);           \
    } while (0)
