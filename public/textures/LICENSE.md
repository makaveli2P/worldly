# Satellite texture licence

The files `earth-*.webp` and `earth-*.jpg` in this folder are licensed under the
**Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International** licence (CC BY-NC-SA 4.0):
https://creativecommons.org/licenses/by-nc-sa/4.0/

This licence applies only to the texture files. It does not apply to the source code of Worldly.

## Attribution

- EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025)
- Polar ice: NASA Blue Marble Next Generation (August 2004, topography and bathymetry), credit: NASA Earth Observatory.
  NASA imagery is generally not subject to copyright in the United States.

## Changes to the source imagery

The texture files are a modified version of the source imagery. `scripts/build-texture.mjs` makes them:

1. It requests the EOX WMS layer `s2cloudless-2025` (EPSG:4326) in parts of 4096 x 4096 px and stitches the parts.
2. It resamples the result to 8192 x 4096 px (Lanczos 3).
3. Poleward of 58°, it replaces flat white and magenta EOX pixels with Blue Marble Next Generation pixels, with a 3 px feather.
4. It resizes the result to 2048, 4096 and 8192 px wide and compresses it as WebP and JPEG.

## Conditions (summary, not legal advice)

- Non-commercial use only. The EOX terms count a personal hobby project as non-commercial.
  A site with ads, paid features or other income needs other imagery (for example the CC BY 4.0
  EOxCloudless 2016 layer `s2cloudless`) or a commercial licence from EOX.
- ShareAlike: if you change these files and share the result, use the same licence.
- Show the attribution above wherever the imagery shows, also on screenshots and videos.

## No warranties

The licensors give the imagery "as is", with no warranties of any kind. See section 5 of the licence:
https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode.en

## Look

The polar blend uses Blue Marble ice only where the EOX mosaic shows land ice. The Arctic Ocean has
no sea ice in the result: the North Pole shows open, dark ocean.

Source terms: https://cloudless.eox.at/license-non-commercial
