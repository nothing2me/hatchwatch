# ESP32-S3 camera (Freenove ESP32-S3 WROOM)

Standalone camera firmware for field tests. The board serves a camera page, a JPEG snapshot, a status JSON and an MJPEG stream on the local Wi-Fi. It is not connected to the dashboard and never talks to the research pipeline.


| URL                     | What                                                                          |
| ----------------------- | ----------------------------------------------------------------------------- |
| `http://<ip>/`          | Camera page: live view, snapshot, sensor and stream status                    |
| `http://<ip>/capture`   | One JPEG (`?download=1` to save it)                                           |
| `http://<ip>/status`    | JSON: sensor, mode, picture size, stream fps, Wi-Fi signal, uptime, free heap |
| `http://<ip>:81/stream` | MJPEG stream (open it in a browser or VLC)                                    |
| `http://<ip>/motion`    | Motion mask (80×60 grey JPEG, white = moving)                                  |
| `POST http://<ip>/motion/settings?threshold=NN` | Motion threshold 5–100 (`?reset=1` relearns the background) |




## Privacy

The pages and the stream have no password: anyone on the same Wi-Fi can watch. Use the board only on a trusted network, and never share footage of a nesting beach publicly.

## Build and upload

1. Copy `secrets.example.h` to `secrets.h` (git-ignored) and set `WIFI_SSID` and `WIFI_PASSWORD`. The board joins 2.4 GHz networks only.
2. Arduino IDE, esp32 core 3.x, Tools:
  - Board: **ESP32S3 Dev Module**
  - PSRAM: **OPI PSRAM**
  - Flash Size: **8MB** (N8R8 module; 16MB for N16R8), Partition Scheme: **8M with spiffs**
  - USB CDC On Boot: **Enabled** if you use the board's native USB port for the Serial Monitor
3. Upload, open the Serial Monitor at 115200 and press reset. It prints the sensor, the mode and the URLs.

Command line (same settings):

```sh
arduino-cli compile -b "esp32:esp32:esp32s3:PSRAM=opi,FlashSize=8M,PartitionScheme=default_8MB,CDCOnBoot=cdc" firmware/esp32s3-cam
arduino-cli upload  -b "esp32:esp32:esp32s3:PSRAM=opi,FlashSize=8M,PartitionScheme=default_8MB,CDCOnBoot=cdc" -p <port> firmware/esp32s3-cam
```

Close the IDE's Serial Monitor before uploading from the command line; it holds the port.

## How it picks a mode

1. **Hardware JPEG** (OV2640, OV3660, OV5640): the sensor compresses each frame, 640×480, double-buffered in PSRAM.
2. **Raw RGB565 + software JPEG** (sensors without JPEG, such as GC0308 on this board, or GC2145): one raw frame at up to 320×240 in **internal RAM**, encoded to JPEG on the ESP32.



## Motion on the board

A capture task owns the camera at 5 fps. Each raw frame is sampled to an 80×60 grey grid and compared with a background that adapts slowly (still objects fade in about 2 s). A cell moves when its brightness differs by more than the threshold (default 20); below 1% of the picture moving counts as still (sensor noise). `/status` reports `motion.percent`, `motion.active`, `motion.box` (x, y, w, h in picture pixels), `motion.secondsSince` and `motion.threshold`, and the Serial Monitor logs when motion starts and stops. It is a viewing aid only: not the digging detector, and it raises no alerts. It works in raw mode (this board's GC0308); with a hardware-JPEG sensor motion stays at 0.

The stream server handles one viewer at a time; a second `/stream` viewer waits until the first closes. Snapshots, status and the motion mask stay available to everyone.

## Why the old sketch showed a striped, rainbow picture

The striped picture with shifted rows came from raw mode with the frame buffer in PSRAM:

- In raw mode every pixel crosses the camera bus as two bytes, and the LCD_CAM camera controller hands them to GDMA (ESP32-S3 TRM, chapter 29).
- On the WROOM-1 Octal-PSRAM modules the PSRAM sits behind the same SPI memory interface as flash (datasheet: IO35–IO37 are wired to it). Wi-Fi, code running from flash and the JPEG encoder all use that bus too.
- When the bus is busy, the camera FIFO overflows before DMA can drain it, so lines are dropped or shifted. The frame still has the right length, so a size check does not catch it.

The fix keeps the raw buffer in internal SRAM, uses one buffer (`CAMERA_GRAB_WHEN_EMPTY`), runs XCLK at 10 MHz in raw mode, starts the camera before Wi-Fi so the large internal block is still free, and paces the stream. `board_pins.h` also checks at compile time that no camera pin uses the PSRAM pins (IO35–IO37) or a strapping pin (IO0, IO3, IO45, IO46).

## If the picture is still wrong

- Check `/status`: `mode` and `psramBuffer` show which path is running.
- Unplug the GPIO extension board and test the bare board. The camera uses GPIO 4–18, and anything wired to those rows corrupts the data lines.
- Reseat the camera ribbon (lift the latch, insert straight and fully, close the latch).
- Use a short, good USB cable or a powered port. Brown-outs during Wi-Fi transmit also cause tearing.

