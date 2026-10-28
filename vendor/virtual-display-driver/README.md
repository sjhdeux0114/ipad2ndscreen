# Virtual Display Driver dependency

This directory contains the signed x64 driver-only package from
`VirtualDrivers/Virtual-Display-Driver` release `25.7.23`.

- Upstream: https://github.com/VirtualDrivers/Virtual-Display-Driver
- Release: https://github.com/VirtualDrivers/Virtual-Display-Driver/releases/tag/25.7.23
- License: MIT (see `LICENSE`)
- Package signer: `SignPath Foundation`
- Signer certificate thumbprint: `3CF8CF26D8BA266C3A483AB7D26D4A818E317D76`

The files are kept byte-for-byte from the upstream driver-only archive so the
catalog and Authenticode signatures remain valid. Do not modify the INF, DLL,
or CAT in place. Product-specific resolutions are written to the external
`C:\VirtualDisplayDriver\vdd_settings.xml` configuration before the driver is
started.
