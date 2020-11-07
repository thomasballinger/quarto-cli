# ---
# title: "leaflet"
# knit: quarto render
# jupyter:
#   jupytext:
#     formats: md,py:percent
#   kernelspec:
#     display_name: Python 3
#     language: python
#     name: python3
# ---

# %% label="fig:leaflet" caption="my map" tags=["remove-code"]
from ipyleaflet import Map, Marker, basemaps, basemap_to_tiles
m = Map(
  basemap=basemap_to_tiles(
    basemaps.NASAGIBS.ModisTerraTrueColorCR, "2017-04-08"
  ),
  center=(52.204793, 360.121558),
  zoom=4
)
m.add_layer(Marker(location=(52.204793, 360.121558)))
m
