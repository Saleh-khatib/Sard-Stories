# test-data (git-ignored, never committed)

Put the M1 test inputs here. Children's photos are personal data: they stay on this machine.

```
test-data/
  scenes/front.png   original illustration, hero seen from the front (full resolution, PNG)
  scenes/side.png    hero in profile
  scenes/back.png    hero seen from behind
  masks/front.png    same size as scenes/front.png: head + neck painted WHITE, everything else BLACK
  masks/side.png
  masks/back.png
  child/photo.jpg    test child photo (parent's consent)
  child/info.json    { "name": "Omar", "gender": "boy" }
```

Masks can be painted in Photopea (free): open the scene, add a black layer, paint the head and neck white with a soft brush, hide the scene, export PNG at the same size.
