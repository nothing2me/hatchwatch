# Optional local turtle model

The local development server loads `/models/turtle.gltf` when present and uses its procedural turtle otherwise. To install the user-supplied CGTrader model locally, run:

```powershell
node scripts/install-turtle.mjs "D:\D_Downloads\Turtle+Sea"
```

The model files are kept in `web/local-models`, ignored by Git and excluded from production builds. The supplied asset's [Royalty Free License](https://help.cgtrader.com/hc/en-us/articles/360015124437-Royalty-Free-License) restricts redistribution of source files.
