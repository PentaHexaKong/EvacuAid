import json
from pathlib import Path

import numpy as np
from PIL import Image

# Redraws the welcome screen's BrandBackdrop (gradient + haze in src/screens/setup.tsx) as the iOS launch-screen
# background. Rerun after changing brand.stops or brand.haze: python3 scripts/make-splash-gradient.py
root = Path(__file__).resolve().parents[1]
brand = json.loads((root / 'src/theme/tokens.json').read_text())['brand']

# The 390x844 viewBox the haze is laid out in; the launch screen stretches it to the device.
width, height = 390, 844
hex_rgb = lambda value: np.array([int(value[i:i + 2], 16) for i in (1, 3, 5)], dtype=float)
stops = [hex_rgb(value) for value in brand['stops']]
locations = [0, 0.42, 1]

# LinearGradient start (0.85, 0) -> end (0.15, 1) in unit coordinates, like the CAGradientLayer behind it.
u, v = np.meshgrid((np.arange(width) + 0.5) / width, (np.arange(height) + 0.5) / height)
start, end = np.array([0.85, 0]), np.array([0.15, 1])
axis = end - start
t = np.clip(((u - start[0]) * axis[0] + (v - start[1]) * axis[1]) / axis.dot(axis), 0, 1)
image = np.stack([np.interp(t, locations, [stop[c] for stop in stops]) for c in range(3)], axis=-1)

# RadialGradient haze: centre (80, 90), r 260 in viewBox units, opacity 0.85 -> 0.
distance = np.hypot((np.arange(width) + 0.5)[None, :] - 80, (np.arange(height) + 0.5)[:, None] - 90)
alpha = (0.85 * np.clip(1 - distance / 260, 0, 1))[..., None]
image = image * (1 - alpha) + hex_rgb(brand['haze']) * alpha

# Dither by under 1 level so the slow gradient does not band.
image += np.random.default_rng(0).uniform(-0.5, 0.5, image.shape)
Image.fromarray(np.clip(np.rint(image), 0, 255).astype(np.uint8), 'RGB').save(root / 'assets/brand/splash-gradient.png', optimize=True)
