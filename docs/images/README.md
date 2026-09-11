# Project Assets & Images

This directory contains visual media, diagrams, and hardware photos used in the repository documentation and GitHub README.

## Included Images

- **`fan_rpm_radar_overview.png`**: Project overview banner illustrating the TI AWR1843BOOST FMCW radar, micro-Doppler spectrum signatures, and real-time RPM edge processing.

## Adding or Replacing Your Own Hardware Photos

If you want to replace this banner with your own physical hardware setup or CCS debug screenshot:

1. Copy your photo/screenshot into this folder:
   ```bash
   cp /path/to/your/photo.jpg docs/images/fan_rpm_radar_overview.png
   # or add a new file:
   cp /path/to/your/hardware_setup.jpg docs/images/hardware_setup.jpg
   ```
2. If you use a different filename, update the image tag at the top of the root `README.md`:
   ```markdown
   <p align="center">
     <img src="docs/images/your_image.png" alt="AWR1843 Fan RPM Radar Setup" width="850">
   </p>
   ```
3. Commit and push:
   ```bash
   git add docs/images/
   git commit -m "docs: update project banner image"
   git push
   ```
