# Latency roadmap

## Web receiver path (implemented)

The current Safari-compatible path now uses:

- H.264 constrained-baseline/packetization-mode preference
- 60 fps sender parameters and resolution-aware bitrate caps
- `maintain-framerate` degradation in ultra-low-latency mode
- `RTCRtpReceiver.jitterBufferTarget = 0` where supported
- the WebRTC `targetLatency: "lowest"` hint where supported
- receiver telemetry for FPS, network RTT, jitter-buffer delay and decode time
- 75 ms signaling polling for faster initial connection (media remains direct WebRTC)

Use the telemetry overlay to separate network and decoder delay from capture/encode/render delay. Test with the Windows PC connected by Ethernet and the tablet on a dedicated 5 GHz or 6 GHz SSID before changing the codec pipeline.

## Moonlight-class path (future native milestone)

Safari/WebRTC is convenient but does not expose full control over capture, hardware-encoder queues, decoder queues or frame presentation. A Moonlight-class gaming target needs a separate native mode:

1. Capture the virtual display with Desktop Duplication or Windows Graphics Capture without Chromium copies.
2. Feed D3D textures directly to NVENC, Intel Quick Sync or AMD AMF using low-delay/no-B-frame presets.
3. Use a native iPad client with VideoToolbox and immediate frame presentation instead of Safari's media pipeline.
4. Send touch, keyboard, mouse and controller input over an unreliable low-latency data channel.
5. Add frame IDs and synchronized timestamps to measure true glass-to-glass latency.

The web mode remains the no-install receiver. The native mode would be an optional gaming receiver rather than a replacement.
